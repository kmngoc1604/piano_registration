const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const rateLimit = require('express-rate-limit');
const basicAuth = require('express-basic-auth');
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- BẢO MẬT TRANG ADMIN ---
const adminAuth = basicAuth({
  users: { [process.env.ADMIN_USER || 'admin']: process.env.ADMIN_PASS || '123456' },
  challenge: true,
  realm: 'Shizuka Piano Admin Area'
});

app.get('/admin', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// CẤU HÌNH GỬI EMAIL (Nodemailer)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// API Lấy danh sách (Có Server-side Pagination & Lọc dữ liệu)
app.get('/api/admin/registrations', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    
    const search = req.query.search || '';
    const status = req.query.status || 'All Status';
    const level = req.query.level || 'All Levels';

    let conditions = [];
    let values = [];
    let paramIndex = 1;

    // Xây dựng điều kiện WHERE động
    if (search) {
      conditions.push(`(full_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`);
      values.push(`%${search}%`);
      paramIndex++;
    }
    
    if (status !== 'All Status') {
      conditions.push(`status = $${paramIndex}`);
      values.push(status);
      paramIndex++;
    }

    if (level !== 'All Levels') {
      conditions.push(`music_level LIKE $${paramIndex}`);
      values.push(`%${level}%`);
      paramIndex++;
    }

    let whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const client = await pool.connect();
    
    // 1. Lấy tổng số bản ghi (phục vụ tính toán Phân trang)
    const countQuery = `SELECT COUNT(*) FROM registrations ${whereClause}`;
    const countResult = await client.query(countQuery, values);
    const total = parseInt(countResult.rows[0].count);

    // 2. Lấy dữ liệu của trang hiện tại (LIMIT / OFFSET)
    const dataValues = [...values, limit, offset];
    const dataQuery = `
      SELECT * FROM registrations 
      ${whereClause} 
      ORDER BY created_at DESC 
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    const dataResult = await client.query(dataQuery, dataValues);
    
    // 3. Lấy dữ liệu Thống kê chung (Cards) không bị ảnh hưởng bởi search/filter
    const statsResult = await client.query(`SELECT status, COUNT(*) as count FROM registrations GROUP BY status`);
    let overallStats = { Total: 0, Pending: 0, Approved: 0, Rejected: 0 };
    statsResult.rows.forEach(row => {
      overallStats[row.status] = parseInt(row.count);
      overallStats.Total += parseInt(row.count);
    });

    client.release();
    
    res.json({ 
      success: true, 
      data: dataResult.rows, 
      total,
      page,
      limit,
      stats: overallStats
    });
  } catch (err) {
    console.error("Error fetching data:", err);
    res.status(500).json({ success: false, message: 'Lỗi máy chủ cơ sở dữ liệu.' });
  }
});

app.patch('/api/admin/registrations/:id/status', adminAuth, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['Pending', 'Approved', 'Rejected'].includes(status)) return res.status(400).json({ success: false, message: 'Trạng thái không hợp lệ.' });
  try {
    const client = await pool.connect();
    const result = await client.query('UPDATE registrations SET status = $1 WHERE id = $2 RETURNING *', [status, id]);
    client.release();
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ.' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Error updating status:", err);
    res.status(500).json({ success: false, message: 'Lỗi máy chủ cơ sở dữ liệu.' });
  }
});

app.delete('/api/admin/registrations/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const client = await pool.connect();
    const result = await client.query('DELETE FROM registrations WHERE id = $1', [id]);
    client.release();
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ.' });
    res.json({ success: true, message: 'Đã xóa hồ sơ thành công.' });
  } catch (err) {
    console.error("Error deleting data:", err);
    res.status(500).json({ success: false, message: 'Lỗi máy chủ cơ sở dữ liệu.' });
  }
});
// -----------------------------

app.use(express.static(path.join(__dirname, 'public')));

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, 
  max: 5,
  message: { success: false, message: 'Bạn đã gửi quá nhiều yêu cầu đăng ký. Vui lòng thử lại sau 1 giờ.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

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
      status VARCHAR(50) DEFAULT 'Pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    const client = await pool.connect();
    await client.query(createTableQuery);
    try {
      await client.query("ALTER TABLE registrations ADD COLUMN status VARCHAR(50) DEFAULT 'Pending'");
    } catch (e) {}
    client.release();
    console.log("Database table 'registrations' ensured.");
  } catch (err) {
    console.error("Error initializing database:", err);
  }
};
initDb();

app.post('/api/register', registerLimiter, async (req, res) => {
  const { 
    full_name, phone, email, birth_year, 
    music_level, learning_goal, preferred_days, 
    preferred_times, class_tier, payment_method, 
    calculated_fee, notes 
  } = req.body;

  if (!full_name || !phone || !email || !birth_year) {
    return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ các trường bắt buộc.' });
  }

  const nameRegex = /^[a-zA-ZÀ-ỿ\s]+$/;
  const phoneRegex = /(84|0[3|5|7|8|9])+([0-9]{8})\b/;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!nameRegex.test(full_name)) return res.status(400).json({ success: false, message: 'Họ và tên không hợp lệ.' });
  if (!phoneRegex.test(phone)) return res.status(400).json({ success: false, message: 'Số điện thoại không hợp lệ.' });
  if (!emailRegex.test(email)) return res.status(400).json({ success: false, message: 'Email không hợp lệ.' });

  try {
    const client = await pool.connect();

    const checkQuery = `SELECT id, email, phone FROM registrations WHERE email = $1 OR phone = $2`;
    const checkResult = await client.query(checkQuery, [email, phone]);
    
    if (checkResult.rows.length > 0) {
      client.release();
      const existing = checkResult.rows[0];
      if (existing.email === email) return res.status(400).json({ success: false, message: 'Địa chỉ Email này đã được đăng ký trước đó.' });
      if (existing.phone === phone) return res.status(400).json({ success: false, message: 'Số điện thoại này đã được đăng ký trước đó.' });
    }

    const insertQuery = `
      INSERT INTO registrations (
        full_name, phone, email, birth_year, 
        music_level, learning_goal, preferred_days, 
        preferred_times, class_tier, payment_method, 
        calculated_fee, notes, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Pending') 
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

    // Gửi Email trong Background (Không chờ bằng await)
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      const feeFormatted = parseInt(calculated_fee).toLocaleString('vi-VN');
      const mailToStudent = {
        from: `"Shizuka Piano" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Xác nhận đăng ký thành công - Shizuka Piano",
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto; color: #333;">
            <h2 style="color: #0f172a;">Cảm ơn bạn đã đăng ký lớp học Piano!</h2>
            <p>Chào <strong>${full_name}</strong>,</p>
            <p>Chúng tôi đã nhận được thông tin đăng ký của bạn. Dưới đây là tóm tắt lịch học bạn đã chọn:</p>
            <ul style="background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; list-style: none;">
              <li><strong>Khóa học:</strong> ${class_tier}</li>
              <li><strong>Hình thức đóng:</strong> ${payment_method}</li>
              <li><strong>Lịch học:</strong> ${preferred_days} (${preferred_times})</li>
              <li><strong>Học phí dự kiến:</strong> ${feeFormatted} VND</li>
            </ul>
            <p>Đội ngũ của chúng tôi sẽ sớm liên hệ qua số điện thoại <strong>${phone}</strong> để tư vấn chi tiết hơn. Hẹn gặp lại bạn tại lớp học!</p>
            <br/>
            <p>Trân trọng,<br/><strong>Shizuka Piano.</strong></p>
          </div>
        `
      };
      
      const mailToAdmin = {
        from: `"Hệ thống Shizuka Piano" <${process.env.EMAIL_USER}>`,
        to: process.env.EMAIL_USER,
        subject: `[Đăng ký mới] ${full_name}`,
        html: `
          <h3>Có học viên mới vừa đăng ký:</h3>
          <p><strong>Tên:</strong> ${full_name}</p>
          <p><strong>SĐT:</strong> ${phone}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Khóa học:</strong> ${class_tier} (${payment_method})</p>
          <p>Vui lòng đăng nhập trang Admin để xem chi tiết.</p>
        `
      };
    
      transporter.sendMail(mailToStudent).catch(err => console.error("Lỗi gửi mail HV:", err));
      transporter.sendMail(mailToAdmin).catch(err => console.error("Lỗi gửi mail Admin:", err));
    }

  } catch (error) {
    console.error("Error inserting data:", error);
    res.status(500).json({ success: false, message: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
