const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_TIMEOUT_MS = 45000;

function normalizeHistory(history) {
    if (!Array.isArray(history)) return [];

    return history
        .filter(item => item && typeof item === "object")
        .slice(-10)
        .map(item => {
            const role = typeof item.role === "string" ? item.role : "user";
            const content = typeof item.content === "string"
                ? item.content
                : String(item.content ?? "");

            return {
                role,
                content: content.trim()
            };
        })
        .filter(item => item.content.length > 0)
        .map(item => ({
            role: item.role === "assistant" ? "assistant" : "user",
            content: item.content
        }));
}

// Cho phép nhận JSON
app.use(express.json({ limit: "10mb" }));

// Cho phép server phục vụ index.html, app.js, style.css...
app.use(express.static(__dirname));

// ================================
// CHEMSAFE AI - CHAT API
// ================================

app.post("/api/chat", async (req, res) => {
    try {
        const payload = req.body || {};
        const rawMessage = payload.message;
        const message = typeof rawMessage === "string" ? rawMessage.trim() : "";
        const history = normalizeHistory(payload.history);

        if (!message) {
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

        const messages = [
            { role: "system", content: systemPrompt },
            ...history.map(item => ({
                role: item.role,
                content: item.content
            })),
            { role: "user", content: message }
        ];

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

        try {
            const ollamaResponse = await fetch(
                `${OLLAMA_URL}/api/chat`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    signal: controller.signal,
                    body: JSON.stringify({
                        model: "gemma3:4b",
                        messages,
                        stream: false
                    })
                }
            );

            if (!ollamaResponse.ok) {
                const errorText = await ollamaResponse.text();
                console.error("Ollama Error:", errorText);
                return res.status(502).json({
                    error: "Không thể kết nối với Ollama."
                });
            }

            const data = await ollamaResponse.json();
            const answer = data?.message?.content || "AI không trả về câu trả lời.";
            return res.json({ answer });
        } catch (error) {
            if (error && error.name === "AbortError") {
                console.error("Ollama timeout:", error);
                return res.status(504).json({
                    error: "Ollama quá thời gian chờ phản hồi."
                });
            }

            console.error("Server Error:", error);
            return res.status(500).json({
                error: "Lỗi server: " + (error && error.message ? error.message : "unknown_error")
            });
        } finally {
            clearTimeout(timeoutId);
        }
    } catch (error) {
        console.error("Request validation error:", error);
        return res.status(500).json({
            error: "Lỗi server: " + (error && error.message ? error.message : "unknown_error")
        });
    }
});

function startServer() {
    return app.listen(PORT, () => {
        console.log("");
        console.log("======================================");
        console.log("       CHEMSAFE AI SERVER");
        console.log("======================================");
        console.log("");

        console.log(`Website: http://localhost:${PORT}`);
        console.log(`Ollama : ${OLLAMA_URL}`);
        console.log("");
        console.log("AI Model: gemma3:4b");
        console.log("");
        console.log("Server đang chạy...");
        console.log("======================================");
    });
}

if (require.main === module) {
    startServer();
}

module.exports = {
    app,
    normalizeHistory,
    startServer
};
