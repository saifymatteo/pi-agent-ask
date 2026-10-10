import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	assistantMessage,
	getToolExecution,
	getToolExecutionDetails,
	getToolExecutionResult,
	PiIntegrationTest,
	testArtifactsDir,
	text,
	toolCall,
} from "pi-coding-agent-test";
import type { AskResult } from "../../src/types.ts";

const call = (id: string, name: string, args: Record<string, unknown>) =>
	assistantMessage([toolCall({ id, name, arguments: args })], {
		stopReason: "toolUse",
	});
const form = (title: string, background = false) => ({
	title,
	background,
	questions: [
		{
			id: "q",
			prompt: "Show your example",
			type: "multi",
			options: [{ value: "yes", label: "Yes" }],
		},
	],
});
const png =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH9sAAAAASUVORK5CYII=";

const clipboardEnvironment = Object.fromEntries([
	[
		"PATH",
		`${fileURLToPath(new URL("../fixtures/image-clipboard/", import.meta.url))}:${process.env.PATH}`,
	],
	["WAYLAND_DISPLAY", "ask-test"],
	["DISPLAY", ""],
	["WSL_DISTRO_NAME", ""],
	["WSL_INTEROP", ""],
]);
const imageExtensions = [
	fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
	fileURLToPath(new URL("../fixtures/image-driver.ts", import.meta.url)),
];
// Runs the real editor, clipboard command, result schema, and background queue.
test("real Pi delivers pasted images from all editors, background paths and clarification", {
	timeout: 90_000,
}, async () => {
	const tmp = fileURLToPath(new URL("../../.tmp/", import.meta.url));
	await mkdir(tmp, { recursive: true });
	const cwd = await mkdtemp(join(tmp, "image-integration-"));
	try {
		const result = await new PiIntegrationTest({
			testName: "ask-images",
			artifactsDir: testArtifactsDir(import.meta.filename),
			cwd,
			isolateUserResources: true,
			rawMode: false,
			timeoutMs: 60_000,
			environment: clipboardEnvironment,
			extensions: imageExtensions,
			tools: ["ask_user", "image_probe", "wait_for_answers"],
			conversation: [
				call("foreground", "ask_user", form("foreground")),
				call("async", "ask_user", form("async", true)),
				call("answer-async", "image_probe", {}),
				call("waited", "ask_user", form("waited", true)),
				call("wait", "wait_for_answers", {}),
				call("clarify", "ask_user", form("clarify")),
				assistantMessage([text("Image verification complete.")]),
			],
		}).run("Verify clipboard images through the real questionnaire.");
		for (const id of [
			"foreground",
			"async",
			"answer-async",
			"waited",
			"wait",
			"clarify",
		]) {
			assert.equal(getToolExecution(result, id).isError, false, id);
		}
		const answer = getToolExecutionDetails(
			getToolExecution(result, "foreground")
		) as AskResult;
		assert.deepEqual(answer.answers.q.values, ["yes"]);
		assert.equal(answer.answers.q.customText, undefined);
		assert.equal(answer.answers.q.customImages?.length, 1);
		assert.equal(answer.answers.q.note, "Question text");
		assert.equal(answer.answers.q.optionNotes?.yes, "Option text");
		for (const id of ["foreground", "wait", "clarify"]) {
			const content = (
				getToolExecutionResult(result, id) as {
					content: Array<{ type: string; data?: string }>;
				}
			).content;
			assert.equal(
				content.filter((item) => item.type === "image").length,
				3,
				id
			);
			assert(
				content
					.filter((item) => item.type === "image")
					.every((item) => item.data === png),
				id
			);
		}
		const clarification = getToolExecutionDetails(
			getToolExecution(result, "clarify")
		) as AskResult;
		const item = clarification.elaboration?.items.find(
			(item) => item.target.kind === "option"
		);
		assert(item && "selected" in item);
		assert.equal(item.selected, false);
		assert.equal(item.images?.length, 1);
		const snapshot = result.traceEvents
			.filter((event) => event.type === "session_snapshot")
			.at(-1);
		assert(Array.isArray(snapshot?.branch));
		const messages = snapshot.branch.filter(
			(entry) =>
				entry.type === "custom_message" &&
				entry.customType === "ask:background-answer"
		);
		assert.equal(messages.length, 1);
		assert.equal(
			messages[0].content.filter(
				(part: { type: string }) => part.type === "image"
			).length,
			3
		);
		assert(JSON.stringify(result.providerRequests).includes(png));
		assert(result.tuiRenderedOutput.includes("[1 image]"));
		const observations = JSON.parse(
			await readFile(join(cwd, "image-editor-observations.json"), "utf8")
		) as Record<string, string[]>;
		assert.equal(Object.keys(observations).length, 4);
		for (const screens of Object.values(observations)) {
			assert(
				!screens.some((screen) => screen.includes("FAIL:")),
				screens.join("\n")
			);
			assert(screens.some((screen) => screen.includes("[2 images]")));
			assert(
				screens.some((screen) => screen.includes("No image in the clipboard"))
			);
			assert(
				screens.some((screen) =>
					screen.includes("Image clipboard is unavailable")
				)
			);
			assert(screens.at(-1)?.includes("Question text [1 image]"));
		}
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("aborting a real pasted-image form does not retain images in its result or history", {
	timeout: 60_000,
}, async () => {
	const tmp = fileURLToPath(new URL("../../.tmp/", import.meta.url));
	await mkdir(tmp, { recursive: true });
	const cwd = await mkdtemp(join(tmp, "image-abort-"));
	try {
		const result = await new PiIntegrationTest({
			testName: "abort-images",
			artifactsDir: testArtifactsDir(import.meta.filename),
			cwd,
			isolateUserResources: true,
			rawMode: false,
			environment: clipboardEnvironment,
			extensions: imageExtensions,
			tools: ["ask_user"],
			conversation: [call("abort", "ask_user", form("abort"))],
		}).run("Ask for an example, then interrupt the form.");
		const response = getToolExecutionDetails(
			getToolExecution(result, "abort")
		) as AskResult;
		assert.equal(response.cancelled, true);
		assert(!JSON.stringify(response).includes(png));
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
