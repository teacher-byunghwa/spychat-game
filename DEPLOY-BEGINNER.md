# 온라인 스파이게임: GitHub + 기존 AWS Lightsail 설치 안내

## 먼저 확인

- 기존 얼음땡 서비스의 파일, 포트, PM2 프로세스, Nginx 설정을 덮어쓰거나 삭제하지 않습니다.
- GitHub에는 기존 얼음땡 저장소 대신 **새 저장소** `classroom-spy-game`를 만듭니다.
- 학생들이 접속할 HTTPS 주소는 별도로 필요합니다. 이미 보유한 도메인의 새 서브도메인을 활용할 수 있습니다.
- 서버 재시작 시 방과 누적 점수가 사라집니다. 수업 도중 재시작하지 않습니다.

## 1. GitHub 업로드

1. GitHub 로그인 → + → New repository.
2. Repository name: `classroom-spy-game` / Private 권장 / Create repository.
3. 웹 화면의 **uploading an existing file** 또는 **Add file → Upload files** 메뉴를 엽니다.
4. 압축을 해제한 `spy-chat-game` 폴더 **안**에 있는 `server.js`, `package.json`, `README.md`, `public/` 폴더, `.gitignore`, `simulate-test.js` 등을 업로드합니다. 최상위에서 `server.js`가 보여야 합니다. `.gitignore`는 숨김파일이라 브라우저 업로드 시 누락될 수 있으나 없어도 동작합니다.
5. Commit changes 클릭. GitHub에서 `server.js`와 `public/`이 표시되면 성공.

## 2. Lightsail 연결 전 기존 서비스 환경 살피기

AWS Lightsail → Instances → 기존 서버의 Connect using SSH를 누릅니다. 아래 명령은 **조회용**입니다.

```bash
pwd
whoami
node -v
npm -v
git --version
pm2 list
sudo nginx -t
sudo ls /etc/nginx/sites-enabled/
```

명령 일부가 `command not found`여도 즉시 문제라는 뜻은 아닙니다. 기존 운영 방식에 따라 다릅니다.

## 3. 새 폴더에 설치

`YOUR_GITHUB_USERNAME`을 본인 GitHub 사용자명으로 바꾸세요. Private 저장소는 인증이 별도로 필요합니다. GitHub 계정 비밀번호를 터미널에 직접 입력해 사용하는 방식은 권장하지 않습니다.

```bash
cd ~
git clone https://github.com/YOUR_GITHUB_USERNAME/classroom-spy-game.git
cd classroom-spy-game
npm install
PORT=3100 node server.js
```

위 마지막 명령으로 서버가 켜지면 다른 SSH 탭에서 `curl http://127.0.0.1:3100/health`를 실행해 확인합니다. `Ctrl+C`로 임시 실행을 종료합니다.

## 4. PM2로 상시 실행 (PM2가 설치된 경우)

```bash
cd ~/classroom-spy-game
PORT=3100 pm2 start server.js --name classroom-spy --update-env
pm2 list
pm2 logs classroom-spy --lines 30
```

기존 얼음땡 PM2 서비스를 삭제하거나 재시작하지 마세요. 기존 서비스가 3100 포트를 사용 중이라면 다른 미사용 포트를 선택해야 합니다. `pm2 save`는 기존 구성 확인 후 실행하는 편이 안전합니다.

## 5. HTTPS 주소 연결 (Nginx가 설치된 서버인 경우)

- 사용 중인 도메인과 DNS를 확인합니다. 예를 들어 `spy.example.com`을 Lightsail 고정 공인 IP로 연결합니다.
- **별도의 Nginx server 블록**을 구성합니다. 기존 얼음땡 블록은 수정하지 않습니다.

```nginx
server {
    listen 80;
    server_name spy.example.com;
    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

이것은 예시이며 실제 서버의 도메인과 설정 파일 경로를 확인한 후에만 적용합니다. `sudo nginx -t` 확인 전에는 재시작하지 않습니다. HTTPS 인증서는 AWS 공식 Certbot 지침에 따라 발급해야 합니다. QR코드에 HTTPS 주소가 나오는지도 확인하세요.

## 6. 교실 실기기 테스트

- 교사 PC에서 방 생성, 학생 기기 3대로 접속 후 시작
- 제시어 비공개, 스파이/일반학생 역할 카드, 채팅 하이라이트 확인
- 일반학생 성공/실패 챌린지 익명성, 스파이 제시어 오답 시 정체 공개 확인
- 스파이 정답 시 본인 +2점, 다른 스파이 +1점, 아웃된 스파이 포함 확인
- 다음 라운드 누적 점수, 효과음, 일시정지, 강퇴, 새로고침 후 재접속 확인
- 이후 학생 20~30명이 실제 학교 Wi-Fi/모바일망에서 접속하고 10분 이상 진행하며 로그와 응답 지연 확인

## 7. 이후 업데이트

GitHub에 수정된 파일을 올린 뒤, 서버에서는 아래처럼 업데이트할 수 있습니다. 수업 중에는 업데이트하지 마세요.

```bash
cd ~/classroom-spy-game
git pull
npm install
pm2 restart classroom-spy --update-env
```

`git pull`이 실패하면 무작정 파일을 삭제하지 말고 오류 내용을 먼저 확인하세요.

## 이번 작업에서 확인한 테스트의 의미

`npm run test:logic`는 Express/Socket.IO 실제 네트워크 연결 없이 가짜 소켓 객체로 서버 이벤트 로직을 확인하는 **모의 테스트**입니다. 35명과 30명 규모, 총 92개 검증을 통과했습니다. 실제 패키지 설치가 이 작업 환경에서 시간 초과되어 실네트워크 동시 접속 테스트는 하지 못했습니다.
