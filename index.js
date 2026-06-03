const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Cấu hình Rate Limiting (Chống Spam)
// Giới hạn mỗi IP chỉ được gửi tối đa 5 form đăng ký trong vòng 1 giờ
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, 
  max: 5,
  message: { success: false, message: 'Bạn đã gửi quá nhiều yêu cầu đăng ký. Vui lòng thử lại sau 1 giờ.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Cấu hình kết nối Postgres (Hỗ trợ Render.com)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Tự động tạo bảng nếu chưa tồn tại
const initDb = async () => {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS registrations (
      id SERIAL PRIMARY KEY,
      full_name VARCHAR(255) NOT NULL,
      phone VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      birth_year INT NOT NULL,
      music_level VARCHAR(100) NOT NULL,
      learning_goal TEXT,
      preferred_days TEXT,
      preferred_times TEXT,
      class_tier VARCHAR(100),
      payment_method VARCHAR(100),
      calculated_fee INT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    const client = await pool.connect();
    await client.query(createTableQuery);
    client.release();
    console.log("Database table 'registrations' ensured.");
  } catch (err) {
    console.error("Error initializing database:", err);
  }
};

initDb();

// API xử lý đăng ký, có áp dụng Rate Limit chống spam
app.post('/api/register', registerLimiter, async (req, res) => {
  const { 
    full_name, phone, email, birth_year, 
    music_level, learning_goal, preferred_days, 
    preferred_times, class_tier, payment_method, 
    calculated_fee, notes 
  } = req.body;

  // Validate backend để đảm bảo an toàn tuyệt đối
  if (!full_name || !phone || !email || !birth_year) {
    return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ các trường bắt buộc.' });
  }

  // Double check Regex ở Backend
  const nameRegex = /^[a-zA-ZÀ-ỿ\s]+$/;
  const phoneRegex = /(84|0[3|5|7|8|9])+([0-9]{8})\b/;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!nameRegex.test(full_name)) return res.status(400).json({ success: false, message: 'Họ và tên không hợp lệ.' });
  if (!phoneRegex.test(phone)) return res.status(400).json({ success: false, message: 'Số điện thoại không hợp lệ.' });
  if (!emailRegex.test(email)) return res.status(400).json({ success: false, message: 'Email không hợp lệ.' });

  try {
    const client = await pool.connect();

    // KIỂM TRA TRÙNG LẶP DỮ LIỆU (Duplicate Check)
    const checkQuery = `SELECT id, email, phone FROM registrations WHERE email = $1 OR phone = $2`;
    const checkResult = await client.query(checkQuery, [email, phone]);
    
    if (checkResult.rows.length > 0) {
      client.release();
      const existing = checkResult.rows[0];
      if (existing.email === email) {
        return res.status(400).json({ success: false, message: 'Địa chỉ Email này đã được đăng ký trước đó. Vui lòng sử dụng Email khác.' });
      }
      if (existing.phone === phone) {
        return res.status(400).json({ success: false, message: 'Số điện thoại này đã được đăng ký trước đó. Vui lòng sử dụng số điện thoại khác.' });
      }
    }

    // Nếu không trùng, thực hiện Insert
    const insertQuery = `
      INSERT INTO registrations (
        full_name, phone, email, birth_year, 
        music_level, learning_goal, preferred_days, 
        preferred_times, class_tier, payment_method, 
        calculated_fee, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
      RETURNING *;
    `;
    
    const values = [
      full_name, phone, email, birth_year,
      music_level, learning_goal, preferred_days,
      preferred_times, class_tier, payment_method,
      calculated_fee, notes
    ];
    
    await client.query(insertQuery, values);
    client.release();

    res.status(201).json({ success: true, message: 'Đăng ký thành công!' });
  } catch (error) {
    console.error("Error inserting data:", error);
    res.status(500).json({ success: false, message: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
