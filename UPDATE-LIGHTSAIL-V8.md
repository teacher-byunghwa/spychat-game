# V8 업데이트: GitHub → Lightsail

1. ZIP 압축 해제 후, `spy-chat-game` 폴더 **안에 있는 내용**으로 GitHub `teacher-byunghwa/spychat-game` 저장소의 해당 파일을 갱신한다. 특히 `server.js`, `public/app.js`, `public/style.css`, `simulate-test.js`가 바뀌었다.
2. 진행 중인 수업이 없을 때 서버 SSH에서 다음을 실행한다:

```bash
cd ~/spychat-game
git pull origin main
node --check server.js
node --check public/app.js
node simulate-test.js
pm2 restart spychat-game --update-env
pm2 list
curl -I http://127.0.0.1:3100/
```

3. 학생용 브라우저에서 새로고침(필요 시 강력 새로고침) 후 점수와 탈락 팝업을 시험한다.
4. `pm2 restart spychat-game`은 방/점수 데이터를 메모리에서 초기화한다. 기존 `ice-tag`, `mafia`, `spy-game`은 재시작하지 않는다.

만약 GitHub 기본 브랜치가 `master`이면 `git pull origin main` 대신 `git pull origin master`를 쓴다.
