# VOLU-MOD

DCInside 공개 게시글 조회수를 전역 공유 볼륨으로 사용하는 대회용 웹 앱입니다.

- 일반 모드: 게시글 `9` 조회수 `% 100`
- 제목낚시 부스트: 게시글 `10` 조회수 `% 101`
- 페이지 앵커: 게시글 `11`, `8`
- 실시간 전달: 서버의 단일 폴러 + Server-Sent Events
- 삭제 대응: 마지막 음량 동결 + 디스코드 웹훅 1회 알림

브라우저 보안상 운영체제의 마스터 볼륨이 아니라 이 페이지에서 재생하는
합성 테스트음 또는 사용자가 고른 로컬 오디오 파일의 볼륨을 조절합니다.

## 구조

```text
DCInside gallery list HTML
          ↑
          │ one shared adaptive poller
          │
Node.js server ─── Discord deletion webhook
          │
          └── SSE ── all visible browser tabs
```

사용자 수가 늘어도 DCInside 요청 수는 늘지 않습니다. 브라우저 탭이 보이는
동안에는 기본 2초, 조회수 변화 직후에는 제한된 시간 동안 1초, 접속자가
없을 때에는 30초 주기로 동작합니다. 1초 가속은 최대 20초 뒤 종료되고
30초 cooldown을 거치며, 어떤 요청도 전역 최소 간격보다 앞당겨지지 않습니다.
상류 서버 오류가 발생하면 최대 60초까지 자동으로 백오프합니다.

## 로컬 실행

보안 수정이 포함된 Node.js 22.23 이상이 필요합니다.

```sh
npm ci
npm run dev
```

개발 명령은 실제 DCInside 대신 내장 모의 오라클을 사용합니다. 브라우저에서
`http://127.0.0.1:3000`을 엽니다.

실제 공개 목록을 사용하려면:

```sh
npm start
```

## 디스코드 삭제 알림

`.env.example`을 `.env`로 복사하고 디스코드 채널에서 만든 웹훅 URL을 넣습니다.
웹훅 URL은 비밀번호처럼 취급하며 Git에 커밋하지 않습니다.

```dotenv
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/REPLACE_ME
DISCORD_MENTION=<@DISCORD_USER_ID>
PUBLIC_BASE_URL=https://your-public-url.example
```

설정 후 실제 채널에 테스트 메시지를 한 번 전송합니다.

```sh
npm run test:discord
```

서버는 양쪽 센티널 `11`, `8`을 모두 찾았는데 내부 타깃만 연속 3회
사라졌을 때 삭제로 확정합니다. 마지막 정상 조회수와 볼륨을 유지하며 같은
게시글에 대한 알림은 한 번만 전송합니다. 알림 여부와 마지막 값은
`runtime/oracle-state.json`에 원자적으로 저장됩니다.

센티널 자체가 연속 3회 보이지 않아도 별도 Discord 운영 알림을 보냅니다.
사용자나 역할 푸시를 원하면 `DISCORD_MENTION`에 정확한 `<@사용자ID>` 또는
`<@&역할ID>` 형식을 사용합니다. `@everyone`과 임의 멘션 파싱은 허용하지
않습니다.

## 삭제된 글을 수동으로 교체하기

새 게시글과 그 바깥쪽 확인용 게시글을 작성한 뒤
`config/oracles.json`의 다음 값을 변경합니다.

```json
{
  "guards": { "newer": 14, "older": 11 },
  "modes": {
    "normal": { "postNo": 12 },
    "boost": { "postNo": 13 }
  }
}
```

서버는 설정 파일의 변경 시각을 매 폴링마다 확인하므로 프로세스를 재시작하지
않아도 새 번호를 읽습니다. 두 타깃은 반드시 두 센티널 사이의 연속 블록에
있어야 합니다.

## 검증

```sh
npm run verify
```

이 명령은 HTML 파서, 페이지 경계 이동, 삭제 확정, 알림 중복 방지, 상태
복구, 소스 문법, 비밀키 누출, HTTP 동작과 조회수 변화 반영을 검사합니다.

## snb-macbook-pro 배포

권장 설치 경로는 `/Users/snb/Services/volume-oracle`입니다. 파일을 복사하고
원격 Mac에서 다음 명령을 실행합니다.

```sh
zsh scripts/install-snb-service.sh /Users/snb/Services/volume-oracle
```

설치 스크립트는 `launchd` 사용자 서비스를 등록하고 `127.0.0.1:3000`의
상태 API까지 확인합니다. 서비스는 외부 네트워크 인터페이스에 직접 바인딩하지
않습니다. Node heap을 256MB로 제한하고 연결 상한보다 넉넉한 파일
디스크립터 여유를 남깁니다. SSH agent 소켓은 서비스 환경에서 제거하며,
로그는 권한 `0600`과 최대 5MB 두 세대로 유지합니다. 설치 직후 상태 확인은
프로세스 시작 지연을 고려해 제한된 횟수만 재시도합니다.

공개 HTTPS 주소가 필요할 때에만 Tailscale Funnel을 별도로 승인하고 다음과
같이 로컬 서버를 공개합니다.

```sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel --bg 3000
```

Funnel 활성화는 서비스를 인터넷에 공개하는 별도 운영 단계입니다. SSH 포트나
다른 로컬 서비스는 공개하지 않습니다. TS-2026-008이 수정되지 않은 Tailscale
1.98.9 미만에서는 Funnel을 활성화하지 않습니다.

## 공개 웹사이트

정적 UI는 GitHub Pages의 다음 주소에서 제공합니다.

```text
https://sudkorea.github.io/volume/
```

`main` 브랜치에 푸시하면 `.github/workflows/pages.yml`이 전체 테스트·빌드·
스모크 검증을 통과한 뒤에만 `public/` 폴더를 배포합니다. GitHub Actions는
변경 가능한 태그 대신 검증된 commit SHA로 고정합니다. 페이지는 상대 경로로
CSS와 JavaScript를 불러오며, 브라우저에서 실행될 때 다음 Funnel API로
연결합니다.

```text
https://snb-macbook-pro.tail643f01.ts.net
```

백엔드는 `https://sudkorea.github.io` Origin에만 API와 SSE용 CORS 헤더를
반환합니다. Discord 웹훅과 런타임 상태는 GitHub Pages로 전송하거나 저장소에
커밋하지 않습니다. CORS는 브라우저 읽기 정책일 뿐 인증이나 DDoS 방어가
아니므로, 서버는 별도의 전역 요청·SSE 연결·버퍼 상한을 적용합니다.

기본 HTTP Funnel 프록시는 백엔드가 검증할 수 있는 원본 IP를 제공하지 않으므로
임의의 `X-Forwarded-For`는 신뢰하지 않습니다. 현재 상한은 Mac의 메모리와 파일
디스크립터를 보호하지만, 한 공격자가 SSE 200개를 선점하는 서비스 거부까지
막지는 못합니다. 높은 가용성이 필요하면 공개 전에 Tailscale의
[PROXY protocol](https://tailscale.com/docs/reference/tailscale-cli/funnel#use-the-proxy-protocol)을
해석하는 로컬 프록시 또는 별도 edge/WAF를 두고 per-IP 제한을 적용해야 합니다.

## 경계

- 자동 게시, 로그인 자동화, 조회수 조작을 하지 않습니다.
- 타깃 상세 페이지를 폴링하지 않습니다.
- 공개 목록 메타데이터만 읽습니다.
- 디시 HTML 파싱이 연속 실패하면 마지막 음량을 유지하고 요청 간격을 늦춥니다.
- 응답 호스트·타입·크기·목록 구조를 검증하고 차단 HTML은 정상 데이터로
  처리하지 않습니다.
- 전체 게시글 블록이 여러 페이지 이동한 경우에는 cooldown이 있는 제한된
  복구 탐색만 수행합니다. 한 번에 최대 5개 새 페이지만 확인하되, 다음
  cooldown에는 이전 범위 다음부터 이어서 찾습니다.
