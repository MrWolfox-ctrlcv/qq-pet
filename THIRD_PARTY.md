# 第三方组件

本仓库发布自有源码，使用 Apache-2.0。`npm ci` 和 `pip install` 安装的依赖分别保留上游许可证，不能用根目录 LICENSE 替代其条款。没有打包任何依赖二进制、模型权重或 QQ 客户端文件。

| 组件 | 当前锁定版本 | 上游声明 |
| --- | --- | --- |
| Vue、Vite、Vue Router、ws | 见 package-lock.json | MIT |
| TypeScript、Playwright、Transformers.js | 见 package-lock.json | Apache-2.0 |
| sharp | 0.35.5 | Apache-2.0；其 libvips 等原生依赖另有 LGPL 等条款 |
| @ffmpeg-installer/win32-x64 | 4.1.0 | GPLv3 |
| @ffprobe-installer/win32-x64 | 5.1.0 | GPL-3.0 |
| Frida Python | 17.10.0 | wxWindows Library Licence 3.1；其组件保留各自许可 |

FFmpeg/FFprobe 仅用于可选的视频抽帧与音频采样。发布包含这些二进制的安装包时，需要单独处理实际构建的许可证、声明及对应源代码；本源码仓库没有包含这些可执行文件。

Frida 的许可证见 [上游 COPYING](https://github.com/frida/frida-python/blob/main/COPYING)。V8 调度代码是本项目的实现，接口参考 [Frida 官方示例](https://frida.re/docs/examples/javascript/)及 [Node.js 源码](https://github.com/nodejs/node)。

桥接通过已登录的官方客户端运行时访问接口。本仓库不包含 QQ 的程序、提取脚本、数据库、登录凭据、签名服务或任何 NapCat/Lagrange 实现。QQ 的名称及相关商标属于其权利人。本项目与腾讯无隶属关系。

可选 BGE 权重、表情包、参考图和角色素材均需由使用者另行提供；程序的 Apache-2.0 不为这些内容授予权利。
