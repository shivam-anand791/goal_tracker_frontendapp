// -------- CONFIG --------

// For Split Deployment (Vercel + Render)
// 1. UPDATE THIS to your Render URL after deploying your backend
const RENDER_API_URL = "https://habit-tracker-api-a4d3.onrender.com/api";


const API_URL = window.location.origin.includes("localhost") || window.location.origin.includes("127.0.0.1") 
  ? "http://localhost:5000/api" 
  : RENDER_API_URL;


const TOKEN_KEY = "token";

// -------- DOM ELEMENTS --------

const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const forgotForm = document.getElementById("forgotForm");
const resetForm = document.getElementById("resetForm");
const errorMsg = document.getElementById("errorMsg");
const successMsg = document.getElementById("successMsg");

// -------- INIT --------

document.addEventListener("DOMContentLoaded", () => {
  // Check if token is present in URL (reset password flow)
  const params = new URLSearchParams(window.location.search);
  const resetToken = params.get("token");
  const resetEmail = params.get("email");

  if (resetToken && resetEmail) {
    // Show reset password panel
    showPanel(resetForm);
    resetForm.addEventListener("submit", (e) => handleResetPassword(e, resetToken, resetEmail));
    return;
  }

  // Check if user already logged in
  if (localStorage.getItem(TOKEN_KEY)) {
    redirectToApp();
    return;
  }

  // Attach form handlers
  loginForm.addEventListener("submit", handleLogin);
  registerForm.addEventListener("submit", handleRegister);
  forgotForm.addEventListener("submit", handleForgotPassword);
});

// -------- PANEL SWITCHING --------

function showPanel(activeForm) {
  [loginForm, registerForm, forgotForm, resetForm].forEach(f => f.classList.remove("active"));
  activeForm.classList.add("active");
  clearMessages();
}

function toggleForms() {
  const isLogin = loginForm.classList.contains("active");
  showPanel(isLogin ? registerForm : loginForm);
}

function showForgotForm() {
  showPanel(forgotForm);
}

function showLoginForm() {
  showPanel(loginForm);
}

// -------- LOGIN --------

async function handleLogin(e) {
  e.preventDefault();

  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  if (!email || !password) {
    showError("Please fill in all fields");
    return;
  }

  try {
    showError("");
    const response = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      showError(data.message || "Login failed");
      return;
    }

    localStorage.setItem(TOKEN_KEY, data.token);
    showSuccess("Login successful! Redirecting...");
    setTimeout(() => redirectToApp(), 1500);
  } catch (err) {
    showError("Network error. Please try again.");
    console.error(err);
  }
}

// -------- REGISTER --------

async function handleRegister(e) {
  e.preventDefault();

  const name = document.getElementById("regName").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value;
  const confirmPassword = document.getElementById("regConfirmPassword").value;

  if (!name || !email || !password || !confirmPassword) {
    showError("Please fill in all fields");
    return;
  }

  if (password.length < 6) {
    showError("Password must be at least 6 characters");
    return;
  }

  if (password !== confirmPassword) {
    showError("Passwords do not match");
    return;
  }

  try {
    showError("");
    const response = await fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      showError(data.message || "Registration failed");
      return;
    }

    showSuccess("Registration successful! Logging in...");
    // Auto-login directly with the same credentials
    setTimeout(async () => {
      try {
        const loginRes = await fetch(`${API_URL}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        });
        const loginData = await loginRes.json();
        if (loginRes.ok && loginData.token) {
          localStorage.setItem(TOKEN_KEY, loginData.token);
          redirectToApp();
        } else {
          showError("Auto-login failed. Please log in manually.");
          showPanel(loginForm);
        }
      } catch {
        showError("Network error during auto-login.");
        showPanel(loginForm);
      }
    }, 1500);
  } catch (err) {
    showError("Network error. Please try again.");
    console.error(err);
  }
}

// -------- FORGOT PASSWORD --------

async function handleForgotPassword(e) {
  e.preventDefault();

  const email = document.getElementById("forgotEmail").value.trim();
  if (!email) {
    showError("Please enter your email");
    return;
  }

  const btn = forgotForm.querySelector(".auth-btn");
  btn.disabled = true;
  btn.textContent = "Sending...";

  try {
    showError("");
    const response = await fetch(`${API_URL}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });

    const data = await response.json();

    if (!response.ok) {
      showError(data.error || "Something went wrong.");
    } else {
      showSuccess("✅ If that email is registered, a reset link has been sent. Check your inbox.");
      forgotForm.reset();
    }
  } catch (err) {
    showError("Network error. Please try again.");
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Send Reset Link";
  }
}

// -------- RESET PASSWORD --------

async function handleResetPassword(e, token, email) {
  e.preventDefault();

  const newPassword = document.getElementById("newPassword").value;
  const confirmNewPassword = document.getElementById("confirmNewPassword").value;

  if (!newPassword || !confirmNewPassword) {
    showError("Please fill in all fields");
    return;
  }

  if (newPassword.length < 6) {
    showError("Password must be at least 6 characters");
    return;
  }

  if (newPassword !== confirmNewPassword) {
    showError("Passwords do not match");
    return;
  }

  const btn = resetForm.querySelector(".auth-btn");
  btn.disabled = true;
  btn.textContent = "Resetting...";

  try {
    showError("");
    const response = await fetch(`${API_URL}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, email, newPassword })
    });

    const data = await response.json();

    if (!response.ok) {
      showError(data.message || "Reset failed. The link may have expired.");
    } else {
      showSuccess("✅ Password reset successful! Redirecting to login...");
      setTimeout(() => {
        // Clean URL and show login form
        window.history.replaceState({}, document.title, window.location.pathname);
        showPanel(loginForm);
        loginForm.addEventListener("submit", handleLogin);
      }, 2000);
    }
  } catch (err) {
    showError("Network error. Please try again.");
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Reset Password";
  }
}

// -------- MESSAGE HELPERS --------

function showError(msg) {
  if (!msg) {
    errorMsg.classList.remove("show");
    return;
  }
  errorMsg.textContent = msg;
  errorMsg.classList.add("show");
  successMsg.classList.remove("show");
}

function showSuccess(msg) {
  if (!msg) {
    successMsg.classList.remove("show");
    return;
  }
  successMsg.textContent = msg;
  successMsg.classList.add("show");
  errorMsg.classList.remove("show");
}

function clearMessages() {
  errorMsg.classList.remove("show");
  successMsg.classList.remove("show");
}

// -------- REDIRECT --------

function redirectToApp() {
  window.location.href = "index.html";
}
