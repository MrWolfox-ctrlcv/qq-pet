# 原生 QQ 本地桥接

桥接在用户已登录的官方 QQ 进程中运行，通过本机 HTTP/WebSocket 提供 OneBot 兼容接口。它不替代 QQ 登录或验证流程，不创建或初始化账号会话，也不修改 QQ 文件。没有开机启动、登录启动或自动重启任务。

## 1. 准备

先完成根目录的依赖安装与宠物创建，再用官方 QQ 登录相应机器人账号。

```powershell
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r bridge\requirements.txt
npm run setup:bridge -- --account <机器人QQ号> --port 4440
```

配置生成在 `data/bridges/<机器人QQ号>/config.json`，其中包含随机令牌。宠物连接参数同步写入本地私有配置，实时外发仍关闭。多个账号应使用不同端口、配置目录和 QQ 进程。

## 2. 明确选择进程与客户端版本

`attach.py` 要求提供 QQ 主进程 PID、QQ.exe 与加载的 QQNT.dll 路径，以及预先核实的两个文件 SHA-256。脚本检查文件哈希、目标进程路径、模块路径和已登录账号，防止挂到错误进程。

可在任务管理器查看 QQ 主进程 PID；文件哈希用 `Get-FileHash -Algorithm SHA256` 查看。不要仅因哈希校验一致就假定新版本 ABI 兼容：当前实现验证过的是 Windows x64 QQ 9.9.25-42941。`v8_dispatch.py` 的 MSVC 隐式返回参数和 V8 导出需匹配目标版本。

```powershell
.venv\Scripts\python.exe bridge\attach.py `
  --pid <QQ主进程PID> `
  --config "<绝对路径>/data/bridges/<机器人QQ号>/config.json" `
  --qq-exe "<官方QQ.exe绝对路径>" `
  --qq-dll "<已加载QQNT.dll绝对路径>" `
  --exe-sha256 <核实的QQ.exe哈希> `
  --dll-sha256 <核实的QQNT.dll哈希>
```

在与 QQ 相同的 Windows 用户和桌面会话中运行。挂接程序等到原生回调关闭后才卸载调度代码；若显示 `waiting-native-callback`，不要强制结束仍有待执行回调的辅助程序。

## 3. 在面板确认并启用

面板连接应先显示预期账号在线，再打开“允许实时运行”并恢复宠物回复。图片和发送动作仅向配置中的账号、会话范围开放；敏感令牌不在页面回显。

桥接仅监听 `127.0.0.1`，带独立 Bearer 令牌。面板和桥接的数据目录应只允许运行账号及管理员访问。Windows 下需要使用本机文件夹权限管理；POSIX mode 参数不替代 Windows ACL。

## 数据与多账号

事件、消息引用、媒体下载和状态保存在各账号的桥接目录；供后台读取的图片副本位于 `data/provider/native-media/<机器人QQ号>/`。同一消息始终携带原始发送者、会话和来源 ID。

每个 QQ 进程只装入一个账号桥接；在已经运行的桥接上尝试使用另一个账号配置会报错。多宠物后台已经支持分账号运行，但不同 Windows 用户下的双客户端与权限配置仍需部署者实际验证。

当前接口见 `native-provider.cjs`。不要把兼容接口的存在解释为所有 OneBot 动作都已实现；未实现的动作会报错。
