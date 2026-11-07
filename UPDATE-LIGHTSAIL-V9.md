# V9 수정 및 기존 Lightsail 설치 업데이트

## 수정 내용
- 탈락 팝업: `eliminatedId`와 `eliminatedName`을 서버에서 참가자 기록으로 전송합니다. 일반학생 오지목은 **도전한 학생**, 스파이 발각은 **발각된 스파이**, 스파이 오답은 **오답을 낸 스파이**의 실제 게임 별명을 보여줍니다. 예시 이름은 사용하지 않습니다.
- 팝업에는 글자가 포함된 배너 대신 `student-character.png` 또는 `spy-character.png`만 표시하며, 탈락 문구는 그 아래의 별도 텍스트로 표시합니다.
- 교사용 `🆕 새 게임 시작 (점수 초기화)` 버튼: **라운드가 종료되었을 때만 표시**됩니다. 같은 방 코드와 참가자를 유지하면서 전체 점수 0점, 역할·제시어·기록 초기화 후 대기실로 돌아갑니다. 새 제시어를 입력하고 `게임 시작`을 눌러 시작합니다.
- `↻ 다음 라운드 준비 (점수 유지)`는 계속 사용 가능합니다.

## 업데이트 절차
1. 이 ZIP 압축을 풀어 `spy-chat-game` 폴더 **안쪽의 모든 파일과 public 폴더**를 GitHub 저장소 `teacher-byunghwa/spychat-game` 루트에 올려 교체합니다. 기존 `public`의 오래된 파일이 남지 않게 확인하세요.
2. 수업이 끝났을 때 Lightsail SSH에서 다음을 실행합니다.

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

3. 브라우저를 새로고침해 테스트합니다. 이미 떠 있는 오래된 탭은 새로고침해야 변경된 코드가 적용됩니다.
4. `pm2 restart`는 메모리에 저장된 방과 점수를 초기화합니다. **수업 도중 실행하지 마세요.**

참고: 현재 서버는 Node.js 메모리에 게임 데이터를 보관하며 DB에 영구 저장하지 않습니다. 서버 재시작으로 초기화됩니다. 
