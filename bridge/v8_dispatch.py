# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations
import json
from pathlib import Path

def agent_source(marker_path: Path, module_name: str = "node.exe", target_source: str | None = None) -> str:
    marker_literal = json.dumps(str(marker_path), ensure_ascii=True)
    module_literal = json.dumps(module_name, ensure_ascii=True)
    target_source = target_source or (
        "const v=process.versions;"
        "process.getBuiltinModule('node:fs').writeFileSync("
        + marker_literal
        + ",JSON.stringify({node:v.node,v8:v.v8}), 'utf8');"
    )
    target_literal = json.dumps(target_source, ensure_ascii=True)
    return r"""
const mod = Process.getModuleByName(__MODULE_NAME__);
function oneExport(prefix) {
  const matches = mod.enumerateExports().filter(e => e.type === 'function' && e.name.startsWith(prefix));
  if (matches.length !== 1) throw new Error('export match count for ' + prefix + ': ' + matches.length);
  return matches[0].address;
}
const abi = 'win64';
const uvDefaultLoop = new NativeFunction(mod.getExportByName('uv_default_loop'), 'pointer', [], abi);
const uvHandleSize = new NativeFunction(mod.getExportByName('uv_handle_size'), 'size_t', ['int'], abi);
const uvAsyncInit = new NativeFunction(mod.getExportByName('uv_async_init'), 'int', ['pointer', 'pointer', 'pointer'], abi);
const uvAsyncSend = new NativeFunction(mod.getExportByName('uv_async_send'), 'int', ['pointer'], abi);
const uvClose = new NativeFunction(mod.getExportByName('uv_close'), 'void', ['pointer', 'pointer'], abi);
const isolateGetCurrent = new NativeFunction(oneExport('?GetCurrent@Isolate@v8@@'), 'pointer', [], abi);
// MSVC returns these non-trivial C++ wrapper classes through an explicit sret pointer.
// For member methods, the ABI places `this` in RCX and sret in RDX; static methods
// place sret in RCX. Raw output storage avoids Frida's aggregate-return assumptions.
const contextGetCurrent = new NativeFunction(oneExport('?GetCurrentContext@Isolate@v8@@'), 'void', ['pointer', 'pointer'], abi);
const handleScopeCtor = new NativeFunction(oneExport('??0HandleScope@v8@@'), 'void', ['pointer', 'pointer'], abi);
const handleScopeDtor = new NativeFunction(oneExport('??1HandleScope@v8@@'), 'void', ['pointer'], abi);
const tryCatchCtor = new NativeFunction(oneExport('??0TryCatch@v8@@'), 'void', ['pointer', 'pointer'], abi);
const tryCatchDtor = new NativeFunction(oneExport('??1TryCatch@v8@@'), 'void', ['pointer'], abi);
const newFromUtf8 = new NativeFunction(oneExport('?NewFromUtf8@String@v8@@'), 'void', ['pointer', 'pointer', 'pointer', 'int', 'int'], abi);
const compile = new NativeFunction(oneExport('?Compile@Script@v8@@'), 'void', ['pointer', 'pointer', 'pointer', 'pointer'], abi);
const run = new NativeFunction(oneExport('?Run@Script@v8@@QEAA?AV?$MaybeLocal@VValue@v8@@@2@V?$Local@VContext@v8@@@2@@Z'), 'void', ['pointer', 'pointer', 'pointer'], abi);

const asyncType = 1; // UV_UNKNOWN_HANDLE is 0; UV_ASYNC is the first mapped handle type in Node v24.12.0.
const handleBytes = uvHandleSize(asyncType);
if (handleBytes < 1 || handleBytes > 4096) throw new Error('unexpected uv_async_t size: ' + handleBytes);
const asyncHandle = Memory.alloc(handleBytes);
const source = __TARGET_SOURCE__;
let completed = false;
let outcome = null;

const closeCallback = new NativeCallback(function () {
  send({ ...outcome, handleClosed: true });
}, 'void', ['pointer'], abi);
const processPending = new NativeCallback(function () {
  if (completed) return;
  completed = true;
  let scope = NULL;
  let scopeConstructed = false;
  let tryCatchStorage = NULL;
  let tryCatchConstructed = false;
  let stage = 'Isolate::GetCurrent';
  try {
    const isolate = isolateGetCurrent();
    if (isolate.isNull()) throw new Error('v8::Isolate::GetCurrent returned null');
    stage = 'HandleScope::HandleScope';
    scope = Memory.alloc(Process.pointerSize * 4); // Three pointer fields plus an optional checks-only int; this x64 buffer covers either header layout.
    handleScopeCtor(scope, isolate);
    scopeConstructed = true;
    stage = 'TryCatch::TryCatch';
    tryCatchStorage = Memory.alloc(256);
    tryCatchCtor(tryCatchStorage, isolate);
    tryCatchConstructed = true;
    stage = 'Isolate::GetCurrentContext';
    const contextOut = Memory.alloc(Process.pointerSize);
    contextGetCurrent(isolate, contextOut); // this=RCX, sret=RDX; disassembly confirms [RDX] receives the Local handle.
    const context = contextOut.readPointer();
    if (context.isNull()) throw new Error('v8::Isolate::GetCurrentContext returned empty');
    stage = 'String::NewFromUtf8';
    const sourceOut = Memory.alloc(Process.pointerSize);
    newFromUtf8(sourceOut, isolate, Memory.allocUtf8String(source), 0, -1); // static sret=RCX, then isolate=RDX, source=R8, enum=R9, length=stack.
    const scriptSource = sourceOut.readPointer();
    if (scriptSource.isNull()) throw new Error('v8::String::NewFromUtf8 returned empty');
    stage = 'Script::Compile';
    const scriptOut = Memory.alloc(Process.pointerSize);
    compile(scriptOut, context, scriptSource, NULL); // static sret=RCX, then context=RDX, source=R8, origin=R9.
    const script = scriptOut.readPointer();
    if (script.isNull()) throw new Error('v8::Script::Compile returned empty');
    stage = 'Script::Run';
    const resultOut = Memory.alloc(Process.pointerSize);
    run(script, resultOut, context); // member this=RCX, sret=RDX, context=R8.
    const result = resultOut.readPointer();
    if (result.isNull()) throw new Error('v8::Script::Run returned empty');
    outcome = { status: 'executed', uvAsyncBytes: String(handleBytes) };
  } catch (e) {
    outcome = { status: 'error', stage, error: String(e), uvAsyncBytes: String(handleBytes) };
  } finally {
    if (tryCatchConstructed) tryCatchDtor(tryCatchStorage);
    if (scopeConstructed) handleScopeDtor(scope);
    // Close on the target event-loop thread, and report only after libuv has
    // finished with the handle. Detaching earlier leaves a dangling callback.
    uvClose(asyncHandle, closeCallback);
  }
}, 'void', ['pointer'], abi);

const initStatus = uvAsyncInit(uvDefaultLoop(), asyncHandle, processPending);
if (initStatus !== 0) throw new Error('uv_async_init failed: ' + initStatus);
const sendStatus = uvAsyncSend(asyncHandle);
if (sendStatus !== 0) throw new Error('uv_async_send failed: ' + sendStatus);
""".replace("__TARGET_SOURCE__", target_literal).replace("__MODULE_NAME__", module_literal)
