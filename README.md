# MeowField AutoPlay Lite

MeowField AutoPlay Lite 是一个面向游戏内乐器演奏场景的桌面自动演奏工具，提供前端界面、后端播放引擎、游戏配置切换和 Windows 打包能力。

## 当前支持

- 开放空间
  - 钢琴
  - 鼓组
  - 麦克风模式
- 第五人格
  - 钢琴
  - 竖琴
  - 长笛
- 异环
  - 钢琴

## 主要能力

- 支持加载 MIDI 并自动演奏
- 支持按游戏切换键位映射与音域映射
- 支持不同乐器模式的独立配置
- 支持桌面端前后端分离开发
- 支持 Windows 安装包与便携版打包

## 快速上手

### 环境要求

- Windows
- Python 3.10 及以上
- Node.js 18 及以上

### 启动后端

```powershell
cd apps/backend
python -m pip install -e .
python -m src.app.main
```

### 启动前端

```powershell
cd apps/frontend
npm install
npm run dev
```

### 使用流程

1. 启动后端和前端。
2. 在界面中选择目标游戏与乐器模式。
3. 绑定目标游戏进程。
4. 加载 MIDI 文件。
5. 开始播放并切回游戏窗口。

## 打包

在仓库根目录运行：

```powershell
.\build.bat
```

构建脚本会先打包后端，再打包桌面端安装程序。

## 仓库结构

```text
MeowField_AutoPlay_Lite/
├─ apps/
│  ├─ backend/   # Python 后端
│  └─ frontend/  # Electron + React 前端
├─ build.bat     # Windows 构建脚本
├─ LICENSE       # GPL-3.0
└─ README.md
```

## 资源说明

- Web 图标：`apps/frontend/public/favicon.ico`
- Windows 图标：`apps/frontend/build/icon.ico`

## 开源许可

本项目采用 [GPL-3.0](LICENSE) 许可发布。

如果你分发修改版或衍生版本，需要继续按照 GPL-3.0 提供对应源码与许可信息。
