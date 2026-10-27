import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import { requestClipboardImage } from "../src/clipboard-events.ts";

const providerPath = join(
	homedir(),
	".pi",
	"agent",
	"extensions",
	"clipboard-image.ts"
);
const skip = existsSync(providerPath)
	? false
	: `Local clipboard provider absent: ${providerPath}`;
const REQUEST = "pi-agent-ask:clipboard-request";
const RESULT = "pi-agent-ask:clipboard-result";
const LIMIT = 20 * 1024 * 1024;
const HAS_UI = "hasUI";
const RANDOM_UUID = "randomUUID";
interface Image {
	bytes: Uint8Array;
	mimeType: string;
}
type Converted = { data: string; mimeType: string } | null;
type Handler = (...args: any[]) => any;

function harness(
	read: () => Promise<Image | null>,
	convert: Handler = async () => null
) {
	// Execute the actual external factory, never its real imports/platform readers.
	// Only the read boundary is replaced; bridge and chat handlers remain verbatim.
	const source = ts.transpileModule(readFileSync(providerPath, "utf8"), {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
	}).outputText;
	const listeners = new Map<string, Set<Handler>>();
	const lifecycle = new Map<string, Handler>();
	const shortcuts = new Map<string, { handler: Handler }>();
	const results: any[] = [];
	const effects: Array<{ kind: string; args: any[] }> = [];
	const effect =
		(kind: string) =>
		(...args: any[]) =>
			effects.push({ kind, args });
	const events = {
		on(name: string, handler: Handler) {
			const handlers = listeners.get(name) ?? new Set<Handler>();
			listeners.set(name, handlers);
			handlers.add(handler);
			return () => {
				handlers.delete(handler);
			};
		},
		emit(name: string, payload: unknown) {
			for (const handler of [...(listeners.get(name) ?? [])]) {
				handler(payload);
			}
		},
	};
	events.on(RESULT, (result) => results.push(result));
	const mocks: Record<string, unknown> = {
		"node:child_process": {
			spawn: () => assert.fail("Real clipboard process attempted"),
			spawnSync: () => assert.fail("Real clipboard process attempted"),
		},
		"node:crypto": { [RANDOM_UUID]: () => "test-uuid" },
		"node:fs": {
			mkdirSync: effect("mkdir"),
			writeFileSync: effect("write"),
			unlinkSync: effect("unlink"),
		},
		"node:path": { join },
		"node:os": { tmpdir },
		"@earendil-works/pi-coding-agent": { convertToPng: convert },
		"@earendil-works/pi-tui": {
			getNativeClipboard: () => assert.fail("Real native clipboard attempted"),
		},
	};
	const exports: { default?: Handler } = {};
	const load = runInThisContext(
		`(function(require, exports, readStub) {\n${source}\nreadClipboardImage = readStub;\n})`,
		{ filename: providerPath }
	);
	load(
		(name: string) => {
			assert(name in mocks, `Unexpected import: ${name}`);
			return mocks[name];
		},
		exports,
		read
	);
	exports.default?.({
		events,
		on: (name: string, handler: Handler) => lifecycle.set(name, handler),
		registerShortcut: (name: string, shortcut: { handler: Handler }) =>
			shortcuts.set(name, shortcut),
	});
	return {
		effects,
		results,
		events,
		lifecycle,
		shortcuts,
		start() {
			lifecycle.get("session_start")?.(
				{},
				{
					[HAS_UI]: true,
					ui: { notify: effect("notify"), pasteToEditor: effect("draft") },
				}
			);
		},
		request(requestId = "request") {
			events.emit(REQUEST, { version: 1, requestId });
		},
		input(text = "hello") {
			return lifecycle.get("input")?.({ source: "user", text });
		},
	};
}

test("Ask consumes the actual local provider without modifying the chat draft", {
	skip,
}, async () => {
	const h = harness(async () => ({
		bytes: Uint8Array.from([1, 2, 3]),
		mimeType: "image/png",
	}));
	h.start();
	const image = await requestClipboardImage(
		h.events,
		new AbortController().signal
	);
	assert(image);
	assert.equal(image.data, "AQID");
	assert.equal(image.mimeType, "image/png");
	assert.deepEqual(h.effects, []);
	assert.deepEqual(h.input("[Image #1]"), { action: "continue" });
});

async function flush() {
	await new Promise<void>((resolve) => setImmediate(resolve));
}

for (const mimeType of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
	test(`provider returns ${mimeType} with synchronous reading ack and no draft effects`, {
		skip,
	}, async () => {
		let resolve!: (image: Image) => void;
		let reads = 0;
		const h = harness(() => {
			reads++;
			assert.equal(h.results[0]?.status, "reading");
			return new Promise((done) => {
				resolve = done;
			});
		});
		// Factory-time request: no session/UI required, regardless of load order.
		h.request();
		assert.equal(reads, 1);
		assert.deepEqual(h.results, [
			{ version: 1, requestId: "request", status: "reading" },
		]);
		resolve({ bytes: Uint8Array.from([1, 2, 3]), mimeType });
		await flush();
		assert.deepEqual(h.results[1], {
			version: 1,
			requestId: "request",
			status: "image",
			image: { mimeType, data: "AQID" },
		});
		assert.equal(h.results.length, 2);
		assert.deepEqual(h.effects, []);
		assert.deepEqual(h.input("[Image #1]"), { action: "continue" });
	});
}

test("invalid requests are ignored without a read or acknowledgement", {
	skip,
}, () => {
	const h = harness(async () => assert.fail("Invalid request read clipboard"));
	for (const payload of [
		null,
		undefined,
		"request",
		{},
		{ version: 2, requestId: "id" },
		{ version: 1, requestId: "" },
		{ version: 1, requestId: "  " },
		{ version: 1, requestId: 1 },
	]) {
		h.events.emit(REQUEST, payload);
	}
	assert.deepEqual(h.results, []);
});

test("empty, read errors, unsupported MIME and oversized input produce one final result", {
	skip,
}, async () => {
	const cases: Array<{ read: () => Promise<Image | null>; status: string }> = [
		{ read: async () => null, status: "empty" },
		{
			read: async () => ({ bytes: new Uint8Array(), mimeType: "image/png" }),
			status: "empty",
		},
		{
			read: () => Promise.reject(new Error("read failed")),
			status: "error",
		},
		{
			read: async () => ({ bytes: new Uint8Array(1), mimeType: "image/tiff" }),
			status: "error",
		},
		{
			read: async () => ({
				bytes: new Uint8Array(LIMIT + 1),
				mimeType: "image/png",
			}),
			status: "error",
		},
	];
	for (const entry of cases) {
		const h = harness(entry.read);
		h.start();
		h.request();
		await flush();
		assert.deepEqual(
			h.results.map((r) => r.status),
			["reading", entry.status]
		);
		if (entry.status === "error") {
			assert.equal(typeof h.results[1].message, "string");
		}
		assert.deepEqual(h.effects, []);
		assert.deepEqual(h.input("[Image #1]"), { action: "continue" });
	}
});

test("BMP conversion succeeds or returns error for null, rejection, empty or oversized output", {
	skip,
}, async () => {
	const outputs: Array<Converted | Error> = [
		{ data: "AQID", mimeType: "image/png" },
		null,
		new Error("conversion failed"),
		{ data: "", mimeType: "image/png" },
		{ data: Buffer.alloc(LIMIT + 1).toString("base64"), mimeType: "image/png" },
	];
	for (const [index, output] of outputs.entries()) {
		let conversions = 0;
		const h = harness(
			async () => ({ bytes: Uint8Array.from([66, 77]), mimeType: "image/bmp" }),
			(data: string, mime: string) => {
				conversions++;
				assert.equal(data, "Qk0=");
				assert.equal(mime, "image/bmp");
				if (output instanceof Error) {
					throw output;
				}
				return output;
			}
		);
		h.request();
		await flush();
		assert.equal(conversions, 1);
		assert.deepEqual(
			h.results.map((r) => r.status),
			["reading", index === 0 ? "image" : "error"]
		);
		if (index === 0) {
			assert.deepEqual(h.results[1].image, output);
		}
		assert.deepEqual(h.effects, []);
	}
});

test("shutdown finalizes pending reads and suppresses late success after restart", {
	skip,
}, async () => {
	let resolve!: (image: Image) => void;
	const h = harness(
		() =>
			new Promise((done) => {
				resolve = done;
			})
	);
	h.request();
	h.lifecycle.get("session_shutdown")?.();
	assert.deepEqual(
		h.results.map((r) => r.status),
		["reading", "error"]
	);
	h.request("after-shutdown");
	assert.equal(h.results.length, 2);
	h.start();
	resolve({ bytes: Uint8Array.from([1]), mimeType: "image/png" });
	await flush();
	assert.equal(h.results.length, 2);
	assert.deepEqual(h.effects, []);
	h.request("new-session");
	assert.equal(h.results[2].status, "reading");
	resolve({ bytes: Uint8Array.from([2]), mimeType: "image/png" });
	await flush();
	assert.equal(h.results[3].status, "image");
});

test("shutdown during BMP conversion cannot emit stale success", {
	skip,
}, async () => {
	let resolve!: (image: Converted) => void;
	const h = harness(
		async () => ({ bytes: Uint8Array.from([66, 77]), mimeType: "image/bmp" }),
		() =>
			new Promise((done) => {
				resolve = done;
			})
	);
	h.request();
	await flush();
	h.lifecycle.get("session_shutdown")?.();
	resolve({ data: "AQID", mimeType: "image/png" });
	await flush();
	assert.deepEqual(
		h.results.map((r) => r.status),
		["reading", "error"]
	);
});

test("ordinary chat shortcuts still attach temp files and input transforms", {
	skip,
}, async () => {
	const h = harness(async () => ({
		bytes: Uint8Array.from([1, 2, 3]),
		mimeType: "image/png",
	}));
	h.start();
	assert.deepEqual([...h.shortcuts.keys()], ["alt+v", "ctrl+alt+v"]);
	await h.shortcuts.get("alt+v")?.handler();
	assert.deepEqual(
		h.effects.map((e) => e.kind),
		["mkdir", "write", "draft", "notify"]
	);
	assert.equal(h.effects[2].args[0], "[Image #1] ");
	const transformed = h.input("hello [Image #1]");
	assert.equal(transformed.action, "transform");
	assert.deepEqual(transformed.images, [
		{ type: "image", data: "AQID", mimeType: "image/png" },
	]);
	assert(transformed.text.includes("Image #1:"));
	assert.deepEqual(h.input(), { action: "continue" });
	assert.deepEqual(h.results, []);
	h.lifecycle.get("session_shutdown")?.();
	assert.equal(h.effects.at(-1)?.kind, "unlink");
});
