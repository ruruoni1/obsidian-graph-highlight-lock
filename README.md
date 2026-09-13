# 🔒 Graph Highlight Lock

**Obsidian 기본 Graph View에서, 마우스를 올렸을 때 생기는 하이라이트(강조) 상태를 클릭 한 번으로 고정하는 초경량 플러그인입니다.**\
별도의 그래프 화면을 만들지 않습니다.\
여러분이 이미 쓰고 있는 Graph View 위에서 그대로 동작합니다.

---

## 왜 필요한가요?

Obsidian Graph View는 노드에 마우스를 올리면 연결된 노드/링크가 강조되지만, 마우스를 떼는 순간 사라집니다.\
노드가 많은 Vault에서 "이 노트가 뭐랑 연결돼 있었지?"를 확인하려고 마우스를 계속 그 자리에 고정해야 했던 경험, 다들 있으실 겁니다.

**Graph Highlight Lock**은 그 강조 상태를 원하는 노드에 고정(Lock)해서, 마우스를 자유롭게 움직이며 연결 관계를 탐색할 수 있게 해줍니다.

## 핵심 기능

| 동작 | 결과 |
|---|---|
| 노드에 마우스 올리기 | 기본 Obsidian 동작 그대로 (연결 노드/링크 강조) |
| **Alt + 좌클릭** (호버 중인 노드) | 현재 강조 상태를 **고정(Lock)** — 마우스를 옮겨도 유지됨 |
| 연결된 다른 노드에서 Alt + 클릭 | Lock 대상이 이어짐 — **지나온 경로(Trail)가 파란색으로 계속 표시**되어, 어떤 경로로 찾아왔는지 한눈에 보임 |
| 경로 중간 노드를 다시 Alt + 클릭 | 그 지점까지 경로를 되돌림 |
| 연결 없는 노드를 Alt + 클릭 | 새로운 경로로 리셋 |
| `Esc` | Lock 전체 해제 |
| 빈 공간에서 Alt + 클릭 | Lock 전체 해제 |
| 일반 클릭 / 드래그 / 줌 / 우클릭 | **전혀 영향받지 않음** — 기존 Graph View 기능 100% 그대로 |

Global Graph와 Local Graph 둘 다 지원합니다.

## 커맨드 팔레트

- `Graph Highlight Lock: Lock hovered node`
- `Graph Highlight Lock: Clear highlight lock`
- `Graph Highlight Lock: Toggle lock`

## 설정

- **Lock trigger**: Lock에 사용할 보조키 (기본값 `Alt`, `Ctrl`/`Shift`/`Cmd` 등으로 변경 가능)
- **Locked node marker**: 화면 좌상단에 현재 Lock된 경로를 `🔒 A → B → C` 형태로 표시할지 여부

## 설치 방법

아직 커뮤니티 플러그인 목록에 등록되지 않았습니다.\
아래 방법으로 수동 설치해주세요.

1. [Releases](../../releases) 에서 `main.js`, `manifest.json`, `styles.css` 3개 파일을 내려받습니다.
2. Vault 폴더 안의 `.obsidian/plugins/graph-highlight-lock/` 폴더를 만들고 그 안에 3개 파일을 넣습니다.
3. Obsidian → 설정 → 커뮤니티 플러그인에서 "Graph Highlight Lock"을 켭니다.

또는 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 플러그인으로 이 저장소 주소를 등록해서 설치할 수도 있습니다.

## 어떻게 동작하나요? (기술적으로)

Obsidian Graph View는 공식 공개 API가 없습니다.\
이 플러그인은 Graph View가 내부적으로 사용하는 PIXI 기반 렌더러의 **하이라이트 상태(`getHighlightNode`, `onNodeClick` 등)를 그대로 재사용**해서 Lock을 구현합니다.\
별도의 그래프 렌더링 코드를 작성하지 않았기 때문에 가볍고, 기존 Graph View의 시각적 스타일과 100% 동일하게 보입니다.

다만 이는 **비공식(undocumented) 내부 API**이므로, Obsidian이 내부 구조를 변경하면 동작하지 않을 수 있습니다.\
이런 내부 접근은 [`src/graph-adapter.ts`](src/graph-adapter.ts) 한 파일에만 격리되어 있어, 향후 대응이 필요할 때 그 파일만 수정하면 되도록 설계했습니다.

## 개발자용 빌드 방법

```bash
npm install
npm run dev     # 감시 모드로 빌드 (개발 중)
npm run build   # 프로덕션 빌드 (main.js 생성)
```

빌드된 `main.js`, `manifest.json`, `styles.css`를 테스트 Vault의 `.obsidian/plugins/graph-highlight-lock/`에 복사하면 됩니다.

## 향후 계획 (v0.2 이후 검토)

- 다중 Lock / 여러 경로 동시 표시
- 연결 깊이(Depth) 1~3단계 선택
- Lock 노드 전용 색상 커스터마이징
- Lock 상태 저장 (세션 간 유지)

## 라이선스

MIT

---

# 🔒 Graph Highlight Lock (English)

**A lightweight Obsidian plugin that lets you pin (lock) the hover-highlight state of a node in the built-in Graph View with a single click.**
It does not create a separate graph view — it works directly on top of the Graph View you already use.

## Why?

Obsidian's Graph View highlights a node's connections while your mouse hovers over it, but the highlight disappears the moment you move away. In a vault with many notes, that means keeping your mouse frozen in place just to trace a note's connections.

**Graph Highlight Lock** lets you pin that highlight to a node so you can freely move your mouse while exploring the connections.

## Core Features

| Action | Result |
|---|---|
| Hover a node | Default Obsidian behavior (neighbors/edges highlighted) |
| **Alt + Left Click** on a hovered node | **Locks** the current highlight — stays even after the mouse moves away |
| Alt + Click a connected neighbor | The lock extends — the **navigation trail is kept visible in blue**, so you can always see the path you took |
| Alt + Click a node already on the trail | Walks the trail back to that point |
| Alt + Click an unrelated node | Starts a fresh trail |
| `Esc` | Clears the lock entirely |
| Alt + Click on empty space | Clears the lock entirely |
| Normal click / drag / zoom / right-click | **Completely unaffected** — all native Graph View behavior is preserved |

Works with both the Global Graph and Local Graph views.

## Commands

- `Graph Highlight Lock: Lock hovered node`
- `Graph Highlight Lock: Clear highlight lock`
- `Graph Highlight Lock: Toggle lock`

## Settings

- **Lock trigger**: the modifier key used to lock (default `Alt`; `Ctrl`/`Shift`/`Cmd` also supported)
- **Locked node marker**: shows the current locked trail in the top-left corner as `🔒 A → B → C`

## Installation

Not yet in the Community Plugins directory. Install manually for now:

1. Download `main.js`, `manifest.json`, and `styles.css` from [Releases](../../releases).
2. Create a folder `.obsidian/plugins/graph-highlight-lock/` inside your vault and put the 3 files there.
3. Enable "Graph Highlight Lock" under Settings → Community plugins.

Alternatively, install it via [BRAT](https://github.com/TfTHacker/obsidian42-brat) using this repository's URL.

## How it works

Obsidian's Graph View has no official public API. This plugin reuses the **existing highlight state of the internal PIXI-based renderer** (`getHighlightNode`, `onNodeClick`, etc.) instead of drawing its own graph — which keeps it lightweight and visually identical to the native Graph View.

That said, this relies on **undocumented internal APIs**, so it may break on future Obsidian updates. All such access is isolated in a single file, [`src/graph-adapter.ts`](src/graph-adapter.ts), so only that file needs to change if Obsidian's internals shift.

## Building from source

```bash
npm install
npm run dev     # watch mode for development
npm run build   # production build (produces main.js)
```

Copy the built `main.js`, `manifest.json`, and `styles.css` into your test vault's `.obsidian/plugins/graph-highlight-lock/`.

## Roadmap (post-v0.2 candidates)

- Multiple simultaneous locks / trails
- Selectable connection depth (1–3 hops)
- Custom lock color
- Persisting lock state across sessions

## License

MIT
