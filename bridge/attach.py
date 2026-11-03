# SPDX-License-Identifier: Apache-2.0
"""Attach the local bridge to one explicitly selected, already logged-in QQ.

No login replacement, account initialization, binary patching or autostart.
The dispatch ABI is version-specific; see bridge/README.md before attaching.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import threading
import time
from v8_dispatch import agent_source


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid', required=True, type=int)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--qq-exe', required=True, type=Path)
    parser.add_argument('--qq-dll', required=True, type=Path)
    parser.add_argument('--exe-sha256', required=True)
    parser.add_argument('--dll-sha256', required=True)
    parser.add_argument('--reload', action='store_true')
    args = parser.parse_args()
    if os.name != 'nt':
        raise RuntimeError('Native attachment currently supports Windows x64 only')
    config_file = args.config.resolve(strict=True)
    config = json.loads(config_file.read_text(encoding='utf-8'))
    provider = Path(__file__).resolve().parent / 'native-provider.cjs'
    executable, dll = args.qq_exe.resolve(strict=True), args.qq_dll.resolve(strict=True)
    for file, expected in [(executable, args.exe_sha256), (dll, args.dll_sha256)]:
        if len(expected) != 64 or hashlib.sha256(file.read_bytes()).hexdigest() != expected.lower():
            raise RuntimeError('Expected QQ file hash does not match')
    run_root = config_file.parent / 'attach-runs'
    run_root.mkdir(exist_ok=True)
    run_dir = Path(tempfile.mkdtemp(prefix='attach-', dir=run_root))
    os.environ['TEMP'] = os.environ['TMP'] = str(run_dir)
    output = run_dir / 'result.json'
    import frida

    source = r'''(async()=>{
      const fs=process.getBuiltinModule('node:fs');
      const require=process.getBuiltinModule('node:module').createRequire(process.execPath);
      try{
        if(String(globalThis.authData?.uin)!==__ACCOUNT__||globalThis.sessionInited!==true)throw new Error('QQ account is not the configured, logged-in account');
        if(__RELOAD__&&globalThis.__qqPetNativeBridge?.provider){
          await globalThis.__qqPetNativeBridge.provider.stop();
          delete require.cache[require.resolve(__PROVIDER__)];
        }
        const status=require(__PROVIDER__)(__CONFIG__);
        fs.writeFileSync(__OUTPUT__,JSON.stringify({pid:process.pid,provider:status}),{flag:'wx'});
      }catch(error){fs.writeFileSync(__OUTPUT__,JSON.stringify({error:String(error)}),{flag:'wx'});}
    })();'''
    for key, value in {
        '__ACCOUNT__': json.dumps(str(config['accountId'])),
        '__RELOAD__': 'true' if args.reload else 'false',
        '__PROVIDER__': json.dumps(str(provider)),
        '__CONFIG__': json.dumps(str(config_file)),
        '__OUTPUT__': json.dumps(str(output)),
    }.items():
        source = source.replace(key, value)
    guard = r'''
if(Process.arch!=='x64')throw new Error('Unexpected target architecture');
if(Process.mainModule.path.toLowerCase()!==__EXE__.toLowerCase())throw new Error('Target executable mismatch');
if(Process.getModuleByName('QQNT.dll').path.toLowerCase()!==__DLL__.toLowerCase())throw new Error('Target native module mismatch');
'''.replace('__EXE__', json.dumps(str(executable))).replace('__DLL__', json.dumps(str(dll)))
    session = frida.attach(args.pid)
    arrived = threading.Event()
    outcome = []

    def on_message(message, _data):
        outcome.append(message.get('payload', message))
        arrived.set()

    try:
        script = session.create_script(guard + agent_source(output, 'QQNT.dll', source))
        script.on('message', on_message)
        script.load()
        if not arrived.wait(15):
            print(json.dumps({'status':'waiting-native-callback'}), flush=True)
            # Keep callbacks mapped until libuv closes the handle. Killing this
            # helper while a callback is pending can destabilize the QQ process.
            arrived.wait()
        if len(outcome) != 1 or outcome[0].get('status') != 'executed' or not outcome[0].get('handleClosed'):
            raise RuntimeError('Native dispatch did not complete cleanly')
        deadline = time.monotonic() + 15
        while not output.exists() and time.monotonic() < deadline:
            time.sleep(.05)
        if not output.exists():
            raise RuntimeError('Bridge did not return a result; inspect the local runtime')
        result = json.loads(output.read_text(encoding='utf-8'))
        if result.get('error'):
            raise RuntimeError(result['error'])
        print(json.dumps({'attached':True,'pid':args.pid,'nativeHandleClosed':True,'state':result['provider']['state']}))
        return 0
    finally:
        session.detach()


if __name__ == '__main__':
    raise SystemExit(main())
