const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const rateLimit = require('express-rate-limit');
const basicAuth = require('express-basic-auth');
const { Resend } = require('resend');

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

// CẤU HÌNH GỬI EMAIL (Resend API)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// API Lấy danh sách
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
    
    const countQuery = `SELECT COUNT(*) FROM registrations ${whereClause}`;
    const countResult = await client.query(countQuery, values);
    const total = parseInt(countResult.rows[0].count);

    const dataValues = [...values, limit, offset];
    const dataQuery = `
      SELECT *,
        (SELECT COUNT(*) FROM registrations r2 WHERE r2.phone = registrations.phone) as phone_count,
        (SELECT COUNT(*) FROM registrations r3 WHERE r3.email = registrations.email) as email_count
      FROM registrations 
      ${whereClause} 
      ORDER BY created_at DESC 
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    const dataResult = await client.query(dataQuery, dataValues);
    
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

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
      phone VARCHAR(50) NOT NULL,
      email VARCHAR(255) NOT NULL,
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
      learning_mode VARCHAR(50) DEFAULT 'Online',
      location VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    const client = await pool.connect();
    await client.query(createTableQuery);
    
    // Cập nhật CSDL cũ
    try { await client.query("ALTER TABLE registrations ADD COLUMN status VARCHAR(50) DEFAULT 'Pending'"); } catch (e) {}
    try { await client.query("ALTER TABLE registrations ADD COLUMN learning_mode VARCHAR(50) DEFAULT 'Online'"); } catch (e) {}
    try { await client.query("ALTER TABLE registrations ADD COLUMN location VARCHAR(100)"); } catch (e) {}
    
    // Gỡ bỏ thuộc tính UNIQUE để cho phép trùng lặp
    try { await client.query("ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_phone_key"); } catch (e) {}
    try { await client.query("ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_email_key"); } catch (e) {}
    try { await client.query("ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_phone_unique"); } catch (e) {}
    try { await client.query("ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_email_unique"); } catch (e) {}

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
    calculated_fee, notes,
    learning_mode, location
  } = req.body;

  if (!full_name || !phone || !email || !birth_year) {
    return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ các trường bắt buộc.' });
  }
  
  if (learning_mode === 'Trực tiếp' && !location) {
    return res.status(400).json({ success: false, message: 'Vui lòng chọn Tỉnh/Thành phố khi đăng ký học trực tiếp.' });
  }

  const nameRegex = /^[a-zA-ZÀ-ỿ\s]+$/;
  const phoneRegex = /(84|0[3|5|7|8|9])+([0-9]{8})\b/;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!nameRegex.test(full_name)) return res.status(400).json({ success: false, message: 'Họ và tên không hợp lệ.' });
  if (!phoneRegex.test(phone)) return res.status(400).json({ success: false, message: 'Số điện thoại không hợp lệ.' });
  if (!emailRegex.test(email)) return res.status(400).json({ success: false, message: 'Email không hợp lệ.' });

  try {
    const client = await pool.connect();

    // LƯU Ý: Đã gỡ bỏ tính năng chặn đăng ký trùng lặp ở đây.

    const insertQuery = `
      INSERT INTO registrations (
        full_name, phone, email, birth_year, 
        music_level, learning_goal, preferred_days, 
        preferred_times, class_tier, payment_method, 
        calculated_fee, notes, status,
        learning_mode, location
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Pending', $13, $14) 
      RETURNING *;
    `;
    
    const values = [
      full_name, phone, email, birth_year,
      music_level, learning_goal, preferred_days,
      preferred_times, class_tier, payment_method,
      calculated_fee, notes,
      learning_mode || 'Online', location || ''
    ];
    
    await client.query(insertQuery, values);
    client.release();

    res.status(201).json({ success: true, message: 'Đăng ký thành công!' });

    // Gửi Email
    if (resend) {
      const feeFormatted = parseInt(calculated_fee).toLocaleString('vi-VN');
      const locationText = learning_mode === 'Trực tiếp' ? `(Tại ${location})` : '';
        
      // 1. Email cho Admin
      const htmlContentAdmin = `
          <h3>Có học viên mới vừa đăng ký:</h3>
          <p><strong>Tên:</strong> ${full_name}</p>
          <p><strong>SĐT:</strong> ${phone}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Hình thức học:</strong> ${learning_mode} ${locationText}</p>
          <p><strong>Khóa học:</strong> ${class_tier} (${payment_method})</p>
          <br/>
          <p><i>Vui lòng không trả lời email này do đây là hộp thư tự động.</i></p>
          <p>Vui lòng đăng nhập trang Admin để xem chi tiết.</p>
        `;
        
      // 2. Email cho Khách hàng
      const htmlContentUser = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
            <h3 style="color: #0f172a;">Xin chào ${full_name},</h3>
            <p>Cảm ơn bạn đã đăng ký tham gia lớp học tại <b>Shizuka Piano</b>.</p>
            <p>Dưới đây là thông tin đăng ký của bạn:</p>
            <ul style="background: #f8fafc; padding: 16px 32px; border-radius: 8px;">
              <li style="margin-bottom: 8px;"><strong>Khóa học:</strong> ${class_tier}</li>
              <li><strong>Hình thức:</strong> ${learning_mode} ${locationText}</li>
            </ul>
            <p>Chúng tôi sẽ sớm liên hệ với bạn qua số điện thoại <b>${phone}</b> để tư vấn lộ trình và lịch học phù hợp nhất.</p>
            <br/>
            <p>Trân trọng,</p>
            <p><strong>Shizuka Piano</strong></p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
            <p style="font-size: 12px; color: #64748b; font-style: italic;">Vui lòng không trả lời email này do đây là hộp thư tự động.</p>
          </div>
      `;

      await Promise.all([
        resend.emails.send({
          from: 'Shizuka Piano Admin <alert@shizukapiano.info>',
          to: ['huynhluu.thanhthao@gmail.com', 'kminhngoc@gmail.com'],
          subject: `[Đăng ký mới] ${full_name}`,
          html: htmlContentAdmin
        }).catch(err => console.error("Lỗi gửi mail Admin qua Resend:", err)),

        resend.emails.send({
          from: 'Shizuka Piano <no-reply@shizukapiano.info>',
          to: email,
          subject: 'Xác nhận đăng ký lớp học tại Shizuka Piano',
          html: htmlContentUser
        }).catch(err => console.error("Lỗi gửi mail User qua Resend:", err))
      ]);
    }

  } catch (error) {
    console.error("Error inserting data:", error);
    res.status(500).json({ success: false, message: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

module.exports = app;
