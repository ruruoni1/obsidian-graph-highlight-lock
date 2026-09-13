# Graph Highlight Lock — Claude Code 작업 지침

## 프로젝트 목적

Obsidian 기본 Graph View에서 특정 노드의 hover 강조 상태를 사용자가 고정할 수 있는 초경량 플러그인을 개발한다.

핵심 동작:

1. 사용자가 Graph View의 노드에 마우스를 올린다.
2. Obsidian 기본 동작으로 해당 노드와 연결 노드/엣지가 강조된다.
3. 사용자가 Alt + Left Click 한다.
4. 마우스를 다른 곳으로 이동해도 해당 강조 상태가 유지된다.
5. 다른 노드에서 Alt + Click 하면 Lock 대상이 변경된다.
6. Esc 또는 그래프 빈 공간 Alt + Click으로 Lock을 해제한다.

별도의 그래프 시스템을 만들지 않는다.

---

# 최우선 원칙

기존 Obsidian Graph View를 그대로 사용한다.

다음을 만들지 않는다.

- 별도 Graph View
- 별도 Graph Note
- 별도 데이터베이스
- Frontmatter 강제
- Markdown 파일 변경
- Vault 구조 변경

플러그인은 기존 Graph View 위에서만 동작해야 한다.

---

# 개발 대상

프로젝트명:

Graph Highlight Lock

Plugin ID:

graph-highlight-lock

초기 버전:

0.1.0

Desktop Only:

true

개발 우선 환경:

- Windows 11
- Obsidian Desktop
- TypeScript
- 공식 Obsidian plugin API 기반

---

# 중요한 개발 규칙

## 1. 바로 구현하지 말 것

먼저 Obsidian Graph View의 현재 구현 구조를 조사한다.

특히 다음을 확인한다.

- GraphView 클래스 접근 방법
- graph renderer 접근 방법
- hover된 노드 식별 방법
- highlighted node / hovered node 상태
- 연결 노드 및 edge highlight 처리 방식
- Graph View 이벤트
- Global Graph와 Local Graph의 구조 차이

가능하면 현재 Obsidian 버전에 맞춰 조사한다.

---

## 2. 기존 hover 렌더링 재사용

새로운 그래프 렌더러를 만들지 않는다.

가능한 경우 Obsidian이 이미 사용하는 hover/highlight 상태를 재사용한다.

우선순위:

1. Graph renderer 내부 상태/API
2. 기존 renderer method 호출
3. event interception
4. DOM/canvas 조작

CSS-only 방식으로 관계 계산을 구현하지 않는다.

---

## 3. 내부 API 접근 격리

Obsidian Graph 관련 내부 API는 공식 API가 아닐 수 있다.

따라서 반드시 별도 adapter로 분리한다.

예:

`src/graph-adapter.ts`

Obsidian 업데이트 시 graph-adapter.ts만 수정하면 되도록 한다.

main.ts에 내부 API 접근 코드를 흩뿌리지 않는다.

---

# MVP 기능

## Hover

기본 Obsidian Graph hover 동작은 그대로 유지한다.

## Lock

Alt + Left Click으로 현재 hover 노드를 Lock한다.

## Lock 변경

다른 노드에서 Alt + Left Click하면 기존 Lock을 해제하고 새 노드를 Lock한다.

동시에 하나의 노드만 Lock한다.

## Unlock

다음 방법을 지원한다.

- Esc
- Graph 빈 공간 Alt + Left Click
- Command Palette 명령

Command:

`Graph Highlight Lock: Clear highlight lock`

## Toggle

Command Palette:

`Graph Highlight Lock: Toggle lock`

---

# 기존 Graph 기능 보호

다음을 방해하면 안 된다.

- 일반 클릭
- 노트 열기
- 노드 드래그
- 그래프 패닝
- 휠 확대/축소
- 우클릭
- 기본 hover
- Graph 설정 패널

Alt + Click일 때만 특별 동작한다.

---

# 상태

예상 상태 구조:

```ts
interface HighlightLockState {
  lockedNodeId: string | null;
  graphViewId?: string;
}
```

상태는 기본적으로 메모리에만 유지한다.

Vault 파일에 기록하지 않는다.

---

# 성능

polling을 사용하지 않는다.

금지:

- setInterval 기반 감시
- 지속적인 전체 노드 순회
- 지속적인 전체 Graph 재렌더

이벤트 기반으로 처리한다.

Vault가 커져도 Lock 기능 때문에 지속 부하가 생기지 않아야 한다.

---

# 파일 구조

권장:

```text
graph-highlight-lock/
├─ manifest.json
├─ package.json
├─ tsconfig.json
├─ esbuild.config.mjs
├─ src/
│  ├─ main.ts
│  ├─ graph-adapter.ts
│  ├─ highlight-lock.ts
│  ├─ settings.ts
│  └─ types.ts
├─ styles.css
├─ README.md
└─ docs/
   └─ SPEC_v0.1.md
```

필요하면 더 단순화해도 된다.

불필요한 추상화는 하지 않는다.

---

# 개발 단계

## Phase 1 — 조사

코드를 작성하기 전에 다음을 수행한다.

1. Obsidian plugin API 확인
2. Graph View 내부 구조 조사
3. 기존 오픈소스 Graph 관련 플러그인 조사
4. hover highlight를 유지할 수 있는 접근법 후보 제시
5. 각 접근법의 위험성 설명

조사 결과를 먼저 보고한다.

이 단계에서는 구현하지 않는다.

---

## Phase 2 — 구현 계획

다음을 작성한다.

- 사용할 접근 방식
- 접근할 Graph 내부 객체
- 이벤트 처리 방식
- Lock 유지 방식
- Unlock 방식
- 예상 호환성 위험
- 파일별 역할

사용자 확인 후 구현으로 넘어간다.

---

## Phase 3 — MVP 구현

완료 기준:

- [ ] 기본 Graph View 정상
- [ ] 노드 hover 정상
- [ ] Alt + Click으로 highlight Lock
- [ ] 마우스를 이동해도 강조 유지
- [ ] 다른 노드 Alt + Click 시 Lock 변경
- [ ] Esc로 Unlock
- [ ] 빈 공간 Alt + Click으로 Unlock
- [ ] 일반 클릭 정상
- [ ] 노드 drag 정상
- [ ] zoom/pan 정상
- [ ] Obsidian 재시작 시 오류 없음

---

## Phase 4 — 테스트

실제 Obsidian Vault에서 테스트할 수 있도록 빌드한다.

빌드 결과:

```text
main.js
manifest.json
styles.css
```

테스트 설치 위치 예:

```text
<Vault>/.obsidian/plugins/graph-highlight-lock/
```

---

# 금지 사항

다음은 사용자 승인 없이 하지 않는다.

- 기능 범위 확대
- 다중 Lock 구현
- 별도 그래프 UI 개발
- Vault 파일 수정
- Markdown 자동 생성
- 외부 서버 사용
- Telemetry 추가
- 네트워크 통신
- React 등 불필요한 대형 프레임워크 추가

---

# 향후 기능

v0.1 완료 후에만 검토한다.

- Multi Lock
- Depth 2 / 3
- Lock history
- Previous / Next
- Custom highlight color
- Lock persistence
- Keyboard graph navigation

현재는 구현하지 않는다.

---

# 작업 시작 시 첫 응답

처음에는 코드를 작성하지 말고 다음만 보고한다.

1. 이 프로젝트의 목표를 한 문단으로 재정리
2. Obsidian Graph 내부 조사 계획
3. 조사할 오픈소스 프로젝트/자료
4. 예상되는 기술적 난점
5. Phase 1을 시작해도 되는지 확인

상세 개발 명세는 `docs/SPEC_v0.1.md`를 우선 참고한다.
