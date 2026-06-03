document.getElementById('registrationForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const form = e.target;
    const submitBtn = document.getElementById('submitBtn');
    const notification = document.getElementById('notification');
    
    // Lấy dữ liệu từ form
    const data = {
        fullName: form.fullName.value,
        phoneNumber: form.phoneNumber.value,
        email: form.email.value,
        course: form.course.value
    };
    
    // Khóa nút và hiển thị trạng thái loading
    submitBtn.disabled = true;
    submitBtn.textContent = 'Đang xử lý...';
    notification.classList.add('hidden');
    
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        notification.classList.remove('hidden', 'success', 'error');
        
        if (response.ok && result.success) {
            notification.textContent = result.message;
            notification.classList.add('success');
            form.reset(); // Xóa form khi thành công
        } else {
            notification.textContent = result.message || 'Đăng ký thất bại.';
            notification.classList.add('error');
        }
    } catch (error) {
        notification.classList.remove('hidden', 'success');
        notification.classList.add('error');
        notification.textContent = 'Lỗi kết nối đến máy chủ.';
    } finally {
        // Mở khóa nút
        submitBtn.disabled = false;
        submitBtn.textContent = 'Đăng Ký Ngay';
    }
});
