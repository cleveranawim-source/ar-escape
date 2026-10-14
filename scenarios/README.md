# scenarios/

제작 스튜디오에서 **내보내기**한 `.json` 시나리오 파일을 이 폴더에 넣으세요.

그러면 학생들은 아래 주소로 바로 플레이할 수 있습니다.

```
play.html?src=scenarios/파일이름.json
```

예시:

```
https://cleveranawim-source.github.io/ar-escape/play.html?src=scenarios/maum-room.json
```

## 지금 올라가 있는 방

방마다 파일이 따로입니다. **새 방은 새 파일로 올리고, 다른 방 파일을 덮어쓰지 않습니다.**

| 파일 | 방 | 학생 주소 |
|---|---|---|
| `maum-room.json` | 마음의 방 (SEL, 단서 5 + 보너스 1) | `play.html?src=scenarios/maum-room.json&room=반이름` |
| `lost-school-key.json` | 사라진 학교의 열쇠 (중1 도형, 단서 9) | `play.html?src=scenarios/lost-school-key.json&room=반이름` |

현황판에서는 「시나리오 주소」 칸에 파일 경로를 넣으면 그 방의 학생 주소가 만들어집니다.
한 반에서 두 방을 같이 돌릴 때는 방 코드를 다르게 쓰세요(예: `2-3`, `2-3수학`) — 같은 방 코드에 섞이면 현황판 제목이 하나로 나옵니다.

## 참고

- 파일에는 문제·정답·AR 타겟 데이터가 모두 들어 있습니다. 이미지 개수에 따라 2~10MB 정도 됩니다.
- **정답이 그대로 들어 있으므로** 학생이 파일을 직접 열어보면 답을 알 수 있습니다.
  경쟁이 중요한 상황이라면 감독 하에 진행하세요.
- 한글 파일명은 주소에 넣을 때 인코딩이 필요할 수 있습니다. 영문·숫자 파일명을 권장합니다.
