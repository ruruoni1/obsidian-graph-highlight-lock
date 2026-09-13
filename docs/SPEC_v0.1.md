# Graph Highlight Lock 개발 명세 v0.1

## 1. 프로젝트 목적

Obsidian 기본 Graph View에서 노드의 **hover 강조 상태를 사용자가 직접 고정(lock)** 할 수 있게 한다.

현재 Obsidian 기본 Graph View는 특정 노드에 마우스를 올리면 해당 노드와 연결된 노드/링크가 강조되지만, 마우스를 떼는 순간 강조가 해제된다.

이 플러그인은 그 강조 상태를 **클릭 또는 단축 동작으로 유지**해서, 노드가 많은 그래프에서도 연결 관계를 놓치지 않고 따라갈 수 있도록 한다.

---

## 2. 핵심 사용자 시나리오

예시:

`이미지 프롬프트` 노드에 마우스를 올림  
→ 연결된 노드와 링크가 강조됨  
→ 사용자가 해당 노드를 `Alt + 클릭`  
→ 현재 강조 상태가 고정됨  
→ 마우스를 다른 곳으로 옮겨도 강조 유지  
→ 연결된 노드 중 하나를 쉽게 찾아 이동  
→ 다른 노드를 `Alt + 클릭`하면 고정 대상 변경  
→ `Esc` 또는 빈 공간 `Alt + 클릭`으로 고정 해제

---

## 3. 개발 원칙

이 플러그인은 **기본 Obsidian Graph View를 그대로 사용**한다.

별도의 그래프 뷰, 별도의 노트 파일, 별도의 그래프 데이터베이스는 만들지 않는다.

핵심 원칙:

- Obsidian 기본 Graph View 유지
- 기존 Vault 구조 변경 없음
- Markdown 파일 변경 없음
- Frontmatter 강제 없음
- 별도 Graph Note 생성 없음
- UI 최소화
- 기능 하나에 집중
- 기존 Graph 성능에 최소 영향

---

## 4. MVP 기능

### 4.1 Hover 상태 감지

사용자가 Graph View에서 노드에 마우스를 올렸을 때 현재 hover 중인 노드를 감지한다.

상태 예:

```text
hoveredNode
```

---

### 4.2 Highlight Lock

기본 단축 동작:

```text
Alt + Left Click
```

hover 중인 노드를 대상으로 실행한다.

동작:

```text
hover node
→ Alt + Click
→ lockedNode 저장
→ highlight 유지
```

---

### 4.3 Lock 대상 변경

이미 lock 상태에서 다른 노드를 `Alt + Click`하면 기존 lock을 제거하고 새 노드로 변경한다.

MVP에서는 **동시에 한 개의 중심 노드만 Lock**한다.

---

### 4.4 Lock 해제

다음 방법을 지원한다.

기본:

```text
Esc
```

추가:

```text
Graph 빈 공간 Alt + Click
```

명령 팔레트:

```text
Graph Highlight Lock: Clear highlight lock
```

---

## 5. Lock 시 시각적 동작

Lock된 노드는 일반 hover 상태와 구별되어야 한다.

최소 구현:

```text
중심 노드
→ 기본 hover 스타일 유지

연결 노드
→ 기본 Graph highlight 스타일 유지

연결선
→ 기본 Graph hover highlight 유지
```

가능하면 Lock 중심 노드에 추가 표시:

```text
얇은 외곽 링
또는
약간 더 강한 밝기
```

단, 기본 Graph 스타일을 크게 변경하지 않는다.

---

## 6. 중요 UX 요구사항

### 정상 상태

```text
마우스 hover
→ 기본 Obsidian 동작
```

### Lock 상태

```text
hover가 다른 노드로 이동해도
lockedNode 강조 상태는 유지
```

MVP 기본값:

```text
Lock 상태에서는 다른 노드 hover가
locked highlight를 덮어쓰지 않음
```

---

## 7. 다중 선택

MVP에서는 제외한다.

향후 버전에서 다중 Lock을 검토한다.

---

## 8. Local Graph 지원

지원 대상:

```text
Global Graph View
Local Graph View
```

우선순위:

1. Global Graph
2. Local Graph

MVP 개발 시 내부 구조 차이가 크다면 Global Graph부터 구현한다.

---

## 9. 설정 화면

최소 설정만 제공한다.

### Lock Trigger

기본:

```text
Alt + Click
```

후보:

```text
Ctrl + Click
Shift + Click
Middle Click
```

### Unlock Key

기본:

```text
Esc
```

### Visual Marker

옵션:

```text
Locked node marker
ON / OFF
```

기본:

```text
ON
```

---

## 10. Command Palette

다음 명령을 제공한다.

```text
Graph Highlight Lock: Lock hovered node
Graph Highlight Lock: Clear highlight lock
Graph Highlight Lock: Toggle lock
Graph Highlight Lock: Open settings
```

---

## 11. 상태 관리

기본 상태:

```ts
interface HighlightLockState {
  lockedNodeId: string | null;
  graphViewId?: string;
}
```

Vault 파일에는 저장하지 않는다.

기본적으로 Obsidian 실행 세션 동안만 유지한다.

---

## 12. Graph View 전환 시

Graph View를 닫으면 Lock 상태를 초기화한다.

다른 Graph View를 열 경우에도 기본적으로 새 세션으로 처리한다.

---

## 13. 내부 구현 방향

Obsidian Graph View 내부의 renderer가 사용하는 현재 highlight/hover 상태를 감지하고, 해당 상태를 강제로 유지하는 방식으로 구현한다.

예상 접근:

```text
GraphView
↓
renderer
↓
hoveredNode / highlightedNode
↓
lock 상태에서 값 유지
```

가능하면 DOM만 조작하는 방식보다 Graph renderer 내부 상태를 이용한다.

이유:

- 노드 수가 많아도 성능 부담이 적음
- 기존 Graph 렌더링 스타일 활용 가능
- 연결선 강조 상태까지 자연스럽게 유지 가능

---

## 14. DOM 직접 조작은 차선책

1순위:

```text
Graph renderer 내부 highlight API/state
```

2순위:

```text
canvas / DOM event interception
```

3순위:

```text
CSS overlay
```

CSS만으로는 연결 관계 계산이 불가능하므로 핵심 구현에는 적합하지 않다.

---

## 15. 이벤트 처리

예상 이벤트:

```text
mousemove
mouseenter
mouseleave
mousedown
click
keydown
```

주요 로직:

```text
onNodeHover(node)
  hoveredNode = node
```

```text
onAltClick(node)
  lockedNode = node
  applyHighlight(node)
```

```text
onMouseLeave()
  if lockedNode == null
     clearHighlight()
  else
     keepHighlight(lockedNode)
```

```text
onEscape()
  lockedNode = null
  clearHighlight()
```

---

## 16. 기존 Graph 동작 보호

플러그인은 다음 기본 기능을 방해하면 안 된다.

```text
일반 클릭 → 노트 열기
드래그 → 그래프 이동
휠 → 확대/축소
노드 드래그
우클릭 메뉴
hover
```

`Alt + Click`일 때만 플러그인이 개입한다.

---

## 17. 성능 요구사항

Vault 노드 규모 기준:

```text
1,000 nodes
5,000 nodes
10,000 nodes
```

에서도 Lock 자체 때문에 추가 렌더링 루프가 지속적으로 발생하지 않아야 한다.

권장:

```text
polling 금지
setInterval 금지
```

이벤트 기반 처리.

---

## 18. 오류 대응

Graph renderer 내부 API가 Obsidian 업데이트로 변경될 수 있다.

따라서 내부 접근 코드는 별도 모듈로 격리한다.

예:

```text
src/
  graph-adapter.ts
```

Obsidian 버전 변화 시 이 파일만 수정할 수 있도록 설계한다.

---

## 19. 프로젝트 구조

추천:

```text
graph-highlight-lock/
│
├─ manifest.json
├─ package.json
├─ tsconfig.json
├─ esbuild.config.mjs
│
├─ src/
│  ├─ main.ts
│  ├─ graph-adapter.ts
│  ├─ highlight-lock.ts
│  ├─ settings.ts
│  └─ types.ts
│
├─ styles.css
│
├─ README.md
└─ CHANGELOG.md
```

---

## 20. manifest

예정:

```json
{
  "id": "graph-highlight-lock",
  "name": "Graph Highlight Lock",
  "version": "0.1.0",
  "minAppVersion": "1.8.0",
  "description": "Lock and preserve node connection highlighting in Obsidian Graph View.",
  "author": "GOVERSE",
  "isDesktopOnly": true
}
```

초기에는 Desktop 전용으로 잡는 게 안전하다.

---

## 21. 지원 환경

우선 개발 환경:

```text
Windows 11
Obsidian Desktop
GOVERSE_SecondBrain Vault
```

Android/iOS:

```text
v0.1 제외
```

---

## 22. MVP 완료 기준

아래가 모두 되면 v0.1 성공으로 본다.

```text
[ ] 기본 Graph View 열기
[ ] 노드 hover 정상
[ ] Alt + Click으로 강조 고정
[ ] 마우스를 이동해도 강조 유지
[ ] 다른 노드 Alt + Click으로 대상 변경
[ ] Esc로 해제
[ ] 빈 공간 Alt + Click으로 해제
[ ] 일반 클릭은 노트를 정상적으로 엶
[ ] 확대/축소 정상
[ ] 그래프 드래그 정상
[ ] Obsidian 재시작 후 오류 없음
```

---

## 23. 향후 v0.2 후보

MVP가 안정화된 이후:

```text
다중 노드 Lock
Lock History
Back / Forward
연결 깊이 1~3단계 선택
Lock 노드 전용 색상
Lock 노드 자동 중앙 정렬
Lock 상태 저장
키보드 탐색
```

특히 유용할 가능성이 큰 기능:

```text
Depth 1
현재 노드 직접 연결만

Depth 2
연결된 노드의 연결까지

Depth 3
3단계까지 탐색
```

v0.1은 **“Alt+클릭 → 강조 고정 → Esc 해제”** 하나를 안정적으로 구현하는 데 집중한다.
