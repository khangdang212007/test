const express = require("express");
const path = require("path");

const app = express();

const PORT = 3000;
const OLLAMA_URL = "http://localhost:11434";

// Cho phép nhận JSON
app.use(express.json({ limit: "10mb" }));

// Cho phép server phục vụ index.html, app.js, style.css...
app.use(express.static(__dirname));


// ================================
// CHEMSAFE AI - CHAT API
// ================================

app.post("/api/chat", async (req, res) => {

    try {

        const { message, history = [] } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({
                error: "Tin nhắn không được để trống."
            });
        }


        // Prompt chuyên ngành Hóa học
        const systemPrompt = `
Bạn là ChemSafe AI, một trợ lý AI chuyên về Hóa học.

Nhiệm vụ của bạn:

1. Phân tích bài tập Hóa học.
2. Xác định dữ kiện đề bài.
3. Xác định yêu cầu của đề.
4. Chọn công thức phù hợp.
5. Viết phương trình hóa học nếu cần.
6. Tính toán từng bước.
7. Kiểm tra đơn vị.
8. Kiểm tra kết quả.
9. Giải thích dễ hiểu cho sinh viên.
10. Nếu đề bài thiếu dữ kiện thì phải nói rõ.
11. Không được tự bịa dữ kiện.
12. Khi câu hỏi liên quan đến an toàn hóa chất, cần nhắc người dùng kiểm tra SDS/GHS chính thức.

Khi giải bài tập:

- Trình bày dữ kiện.
- Nêu công thức.
- Thay số.
- Tính toán.
- Kết luận.

Nếu người dùng chỉ hỏi kiến thức Hóa học thì giải thích khái niệm rõ ràng bằng tiếng Việt.

Nếu người dùng hỏi về phản ứng hóa học:
- Viết phương trình nếu có thể.
- Cân bằng phương trình.
- Giải thích hiện tượng nếu phù hợp.

Nếu người dùng đưa ra một bài toán:
- Không bỏ qua dữ kiện.
- Không tự tạo dữ kiện còn thiếu.
- Nếu thiếu dữ kiện, hãy nói rõ cần thêm dữ kiện nào.

Không cần trả lời quá dài nếu câu hỏi đơn giản.
`;


        // Chỉ lấy 10 tin nhắn gần nhất
        const recentHistory = history.slice(-10);


        // Tạo lịch sử hội thoại cho AI
        const messages = [

            {
                role: "system",
                content: systemPrompt
            },

            ...recentHistory.map(item => ({
                role: item.role,
                content: item.content
            })),

            {
                role: "user",
                content: message
            }

        ];


        // Gửi câu hỏi sang Ollama
        const ollamaResponse = await fetch(
            `${OLLAMA_URL}/api/chat`,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({

                    model: "gemma3:4b",

                    messages: messages,

                    stream: false

                })
            }
        );


        // Kiểm tra Ollama
        if (!ollamaResponse.ok) {

            const errorText =
                await ollamaResponse.text();

            console.error(
                "Ollama Error:",
                errorText
            );

            return res.status(500).json({

                error:
                    "Không thể kết nối với Ollama."

            });

        }


        // Đọc kết quả
        const data =
            await ollamaResponse.json();


        const answer =
            data?.message?.content ||
            "AI không trả về câu trả lời.";


        // Trả câu trả lời về website
        res.json({

            answer: answer

        });


    } catch (error) {

        console.error(
            "Server Error:",
            error
        );

        res.status(500).json({

            error:
                "Lỗi server: " +
                error.message

        });

    }

});


// ================================
// KHỞI ĐỘNG SERVER
// ================================

app.listen(PORT, () => {

    console.log("");
    console.log("======================================");
    console.log("       CHEMSAFE AI SERVER");
    console.log("======================================");
    console.log("");

    console.log(
        `Website: http://localhost:${PORT}`
    );

    console.log(
        `Ollama : ${OLLAMA_URL}`
    );

    console.log("");

    console.log(
        "AI Model: gemma3:4b"
    );

    console.log("");

    console.log(
        "Server đang chạy..."
    );

    console.log("======================================");

});