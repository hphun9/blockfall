<div align="center">

<img src="web/assets/icons/icon-192.png" width="88" alt="Block Fall">

# Block Fall

**Xếp khối, phá hàng.** Trò xếp hình trên lưới 8×8 — miễn phí, không quảng cáo, không theo dõi, chơi được khi không có mạng.

</div>

---

## Chơi

```bash
npm run serve      # http://localhost:8080
npm test           # 27 bài kiểm tra luật chơi
```

Không cần `npm install` — trò chơi không phụ thuộc thư viện nào.

## Luật

Mỗi lượt có ba khối. Kéo khối xuống bất cứ chỗ nào vừa; lấp đầy một hàng hoặc
một cột thì hàng/cột đó biến mất. Khối **không xoay được**, nên mỗi nước đi là
một quyết định. Hết chỗ đặt cả ba khối là kết thúc ván.

Không có đồng hồ, không có trọng lực. Thua là do tính sai, không phải do phản xạ
chậm — đó là điểm hấp dẫn của thể loại này, và nó chỉ đúng nếu việc chia khối
trung thực.

### Chia khối trung thực

Đây là bài toán thiết kế thật sự. Chia ngẫu nhiên đều nhau thì bàn cờ sẽ đầy
những khối S/Z khó xếp rồi tắc, và người chơi thua vì bộ chia chứ không phải vì
mình — cảm giác đó rất tệ.

Hai cơ chế bảo vệ:

- **Bảng trọng số**: khối nhỏ, dễ xếp được chia thường xuyên; khối khó thì hiếm.
- **Luật lượt bài**: một khay mới **bắt buộc** phải có ít nhất một khối đặt
  được. Nếu không, engine chia lại (tối đa 12 lần).

Khi bàn cờ đầy tới mức không gì cứu nổi, ván kết thúc — thất bại đó thuộc về
người chơi, và tái hiện được từ hạt giống ngẫu nhiên.

## Có gì trong đó

- **Ba giao diện** — *Nebula* neon vũ trụ, *Mochi* kẹo pastel, *Prism* kính mờ.
  Đổi giữa chừng không làm gián đoạn ván đang chơi.
- **Chế độ Hằng ngày** — mọi người nhận cùng một bàn cờ mỗi ngày, tới cả thứ tự
  khối được chia.
- **Ba lần hoàn tác mỗi ván**, và hoàn tác tua lại cả luồng ngẫu nhiên nên không
  thể quay đi quay lại để lấy khối đẹp hơn.
- **Chuỗi liên tiếp**: phá hàng nhiều lượt liền nhau được nhân điểm.
- **Xem trước khi thả** — thấy trước khối sẽ nằm đâu và hàng nào sẽ bay.
- **Khối không đặt được đâu cả thì bị làm mờ**, để thấy trước bẫy thay vì thử cả ba.
- **Tiếng Việt và tiếng Anh**, tự nhận theo máy.
- **Chơi offline** (cài được như ứng dụng), lưu ván đang chơi, mở lại là tiếp tục.
- **Không quảng cáo, không tài khoản, không gửi gì đi đâu.** Âm thanh được tổng
  hợp bằng WebAudio nên trang không gọi tới bên thứ ba nào cả.

## Cấu trúc

```
shared/
  skins.json       mọi màu sắc, bo góc, khoảng cách của ba giao diện
  strings.json     mọi chữ hiển thị, tiếng Việt và tiếng Anh

scripts/
  generate-skins.mjs     skins.json   -> web/styles/skins.css
  generate-strings.mjs   strings.json -> web/src/strings.gen.js
  generate-icons.py      vẽ dấu hiệu nhận diện, icon PWA và ảnh bìa

web/                không framework, không bundler, không phụ thuộc
  src/core/         engine.js, pieces.js, rng.js, storage.js  (thuần, không đụng DOM)
  src/ui/           board, drag, sound
  styles/           base.css viết tay + skins.css sinh ra
  tests/            node --test
```

Lõi trò chơi không biết gì về trang web, và trang web không cài đặt luật nào —
nhờ vậy toàn bộ luật chơi được 27 bài kiểm tra chạy không cần trình duyệt.

## Nguồn gốc và giấy phép

Block Fall là một **bản dựng độc lập** của thể loại xếp khối trên lưới. Không có
tệp mã nguồn, biểu định kiểu hay tài nguyên nào của trò chơi khác trong kho này.
Luật chơi là *cơ chế trò chơi* — thứ mà bản quyền không bảo hộ; còn những gì
được bảo hộ (mã nguồn, hình ảnh, câu chữ, bố cục) đều được viết riêng cho dự án
này.

Sinh khối ngẫu nhiên dùng thuật toán mulberry32 (Tommy Ettinger, phạm vi công
cộng), chia sẻ với [Orbix](https://github.com/hphun9/orbix) để cả danh mục trò
chơi dùng chung một bộ sinh đã được kiểm chứng.

## Giấy phép

[MIT](LICENSE) © 2026 hphun9.
