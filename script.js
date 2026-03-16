// ---------------- CONFIG & STATE ----------------

// For Split Deployment (Vercel + Render)
// 1. UPDATE THIS to your Render URL after deploying your backend
const RENDER_API_URL = "https://your-backend-name.onrender.com/api";

const API_URL = window.location.origin.includes("localhost") || window.location.origin.includes("127.0.0.1") 
  ? "http://localhost:5000/api" 
  : RENDER_API_URL;


const TOKEN_KEY = "token";

// Get JWT token from localStorage
function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY);
}

// Helper function for authenticated API calls
async function authFetch(endpoint, options = {}) {
  const token = getAuthToken();
  if (!token) {
    window.location.href = "auth.html";
    return;
  }

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    ...options.headers
  };

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers
  });

  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = "auth.html";
  }

  return response;
}

// -------- UI helpers --------
function showLoading(visible) {
  const ov = document.getElementById("loadingOverlay");
  if (!ov) return;
  ov.setAttribute("aria-hidden", visible ? "false" : "true");
}

function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// Debounced autosave: reads #saveStatus element dynamically
const debouncedSave = debounce(async () => {
  const saveStatus = document.getElementById("saveStatus");
  if (saveStatus) saveStatus.textContent = "Saving...";
  try {
    await saveState();
    if (saveStatus) {
      saveStatus.textContent = "Saved";
      setTimeout(() => (saveStatus.textContent = ""), 1000);
    }
  } catch (err) {
    console.error("debouncedSave failed", err);
    if (saveStatus) saveStatus.textContent = "Save failed";
  }
}, 800);

// -------- MONTH NAVIGATION STATE --------

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate(); // month is 1-indexed
}

const todayDate = new Date();
let currentYear = todayDate.getFullYear();
let currentMonth = todayDate.getMonth() + 1; // 1-indexed

let state = {
  monthLength: getDaysInMonth(currentYear, currentMonth),
  habits: []
};

// ---------------- INIT ----------------

document.addEventListener("DOMContentLoaded", async () => {
  // Load server state first so UI renders persisted data
  try {
    showLoading(true);
    await loadState();
  } finally {
    showLoading(false);
  }
  initControls();
  renderAll();
  initLogout();
  initThemeToggle();
  initNotifications();
  // Build async visual components
  buildHeatmap();
});

// ---------------- CORE RENDER ----------------

function renderAll() {
  renderHeaderInputs();
  renderHabitTable();
  renderAnalysisTable();
  recalcAll();
}

// ---------------- HEATMAP ----------------

async function buildHeatmap() {
  const container = document.getElementById("heatmapContainer");
  if (!container) return;
  
  try {
    const res = await authFetch(`/months/all`);
    if (!res || !res.ok) throw new Error("Could not load history for heatmap");
    const allMonths = await res.json();
    
    // Create a map of YYYY-MM-DD -> { total: X, done: Y }
    const historyMap = {};
    
    // We want the last 6 months (approx 180 days)
    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth() - 5, 1);
    
    allMonths.forEach(m => {
      const { year, month, monthLength, habits } = m;
      if (year < startDate.getFullYear() || (year === startDate.getFullYear() && month < startDate.getMonth() + 1)) return;
      
      const numHabits = habits ? habits.length : 0;
      if (numHabits === 0) return;
      
      for (let day = 1; day <= monthLength; day++) {
        const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        let completed = 0;
        habits.forEach(h => { if (h.checks && h.checks[day - 1]) completed++; });
        historyMap[dateKey] = { total: numHabits, done: completed };
      }
    });

    const grid = document.createElement("div");
    grid.className = "heatmap-grid";
    
    const firstDayOfWeek = startDate.getDay();
    for (let i = 0; i < firstDayOfWeek; i++) {
      const emptyCell = document.createElement("div");
      emptyCell.style.width = "14px";
      emptyCell.style.height = "14px";
      grid.appendChild(emptyCell);
    }
    
    let currDate = new Date(startDate);
    while (currDate <= today) {
      const dKey = `${currDate.getFullYear()}-${String(currDate.getMonth() + 1).padStart(2, '0')}-${String(currDate.getDate()).padStart(2, '0')}`;
      const cell = document.createElement("div");
      cell.className = "heatmap-cell";
      
      const dayData = historyMap[dKey];
      let level = 0;
      let tooltip = `${dKey}: No habits`;
      
      if (dayData && dayData.total > 0) {
        const percent = dayData.done / dayData.total;
        if (percent === 0) level = 0;
        else if (percent <= 0.3) level = 1;
        else if (percent <= 0.6) level = 2;
        else if (percent <= 0.9) level = 3;
        else level = 4;
        tooltip = `${dKey}: ${dayData.done}/${dayData.total} completed`;
      }
      
      cell.classList.add(`level-${level}`);
      cell.setAttribute("data-tooltip", tooltip);
      
      grid.appendChild(cell);
      currDate.setDate(currDate.getDate() + 1);
    }
    
    container.innerHTML = "";
    container.appendChild(grid);
    container.scrollLeft = container.scrollWidth;

  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="error-text">Failed to load heatmap data.</div>`;
  }
}

// month display + days label
function renderHeaderInputs() {
  const picker = document.getElementById("monthPicker");
  const daysLabel = document.getElementById("monthDaysLabel");
  
  if (picker) {
    const yStr = currentYear.toString();
    const mStr = currentMonth.toString().padStart(2, "0");
    picker.value = `${yStr}-${mStr}`;
  }
  
  if (daysLabel) daysLabel.textContent = `${state.monthLength} days`;

  // dim the next arrow if we're at or beyond current real month
  const nextBtn = document.getElementById("nextMonthBtn");
  const today = new Date();
  
  const isPastMonth = currentYear < today.getFullYear() || 
                     (currentYear === today.getFullYear() && currentMonth < today.getMonth() + 1);
  const isFutureMonth = currentYear > today.getFullYear() || 
                       (currentYear === today.getFullYear() && currentMonth > today.getMonth() + 1);
  
  if (nextBtn) nextBtn.style.opacity = isFutureMonth ? "0.35" : "1";
  
  // update the "CURRENT CYCLE" text recursively
  const cycleLabel = document.querySelector(".header-top span");
  if (cycleLabel) {
    if (isPastMonth) {
      cycleLabel.textContent = "PAST CYCLE";
      cycleLabel.style.color = "var(--text-muted)";
    } else if (isFutureMonth) {
      cycleLabel.textContent = "UPCOMING CYCLE";
      cycleLabel.style.color = "var(--text-muted)";
    } else {
      cycleLabel.textContent = "CURRENT CYCLE";
      cycleLabel.style.color = "var(--accent)";
    }
  }
}

// Habit table (header + body + footer)
function renderHabitTable() {
  const table = document.getElementById("habitTable");
  const theadRow = table.querySelector("thead tr");
  const tbody = table.querySelector("tbody");
  const tfoot = table.querySelector("tfoot");

  // header
  theadRow.innerHTML = "";

  const habitHeader = document.createElement("th");
  habitHeader.textContent = "Habit";
  theadRow.appendChild(habitHeader);

  const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

  for (let day = 1; day <= state.monthLength; day++) {
    const th = document.createElement("th");
    const dateObj = new Date(currentYear, currentMonth - 1, day);
    const dayOfWeek = WEEKDAYS[dateObj.getDay()];
    
    th.innerHTML = `<div class="th-day">${dayOfWeek}</div><div class="th-date">${day}</div>`;
    
    // Highlight today's column header
    const today = new Date();
    if (currentYear === today.getFullYear() && currentMonth === today.getMonth() + 1 && day === today.getDate()) {
      th.classList.add("today-col");
    }
    
    theadRow.appendChild(th);
  }

  // body
  tbody.innerHTML = "";
  state.habits.forEach((habit) => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    const nameWrapper = document.createElement("div");
    nameWrapper.className = "habit-name-cell";

    const nameSpan = document.createElement("span");
    nameSpan.className = "habit-name";
    const safeCat = (habit.category || "General").replace(/[^a-zA-Z0-9]/g, ""); // strip emojis for class name
    nameSpan.innerHTML = `<span>${habit.name}</span> <span class="category-badge cat-${safeCat.toLowerCase()}">${habit.category || "General"}</span>`;

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "habit-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "icon-btn";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => editHabitName(habit.id));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn";
    delBtn.textContent = "Del";
    delBtn.addEventListener("click", () => deleteHabit(habit.id));

    actionsDiv.appendChild(editBtn);
    actionsDiv.appendChild(delBtn);

    nameWrapper.appendChild(nameSpan);
    nameWrapper.appendChild(actionsDiv);
    nameTd.appendChild(nameWrapper);
    tr.appendChild(nameTd);

    // figure out if month is fully in the past or future
    const today = new Date();
    const isPastMonth = currentYear < today.getFullYear() || 
                       (currentYear === today.getFullYear() && currentMonth < today.getMonth() + 1);
    const isFutureMonth = currentYear > today.getFullYear() || 
                         (currentYear === today.getFullYear() && currentMonth > today.getMonth() + 1);
    const isCurrentMonth = currentYear === today.getFullYear() && currentMonth === today.getMonth() + 1;
    const currentDayNum = today.getDate();

    for (let day = 0; day < state.monthLength; day++) {
      const td = document.createElement("td");
      
      const isPastDay = isPastMonth || (isCurrentMonth && (day + 1) < currentDayNum);
      const isFutureDay = isFutureMonth || (isCurrentMonth && (day + 1) > currentDayNum);
      const isLockedDay = isPastDay || isFutureDay;
      
      // highlight today's column
      if (isCurrentMonth && (day + 1) === currentDayNum) {
        td.classList.add("today-col");
      }

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!habit.checks[day];
      cb.dataset.habitId = habit.id;
      cb.dataset.dayIndex = String(day);
      
      if (isLockedDay) {
        cb.disabled = true;
        // reuse the same CSS class to dim the checkbox
        cb.classList.add("disabled-past"); 
        cb.title = isPastDay ? "Cannot edit past days" : "Cannot edit future days";
      } else {
        cb.addEventListener("change", onCheckboxChange);
      }
      
      td.appendChild(cb);
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  });

  // footer: daily done + daily progress
  tfoot.innerHTML = "";

  const doneRow = document.createElement("tr");
  const doneLabel = document.createElement("td");
  doneLabel.textContent = "Done";
  doneRow.appendChild(doneLabel);

  for (let day = 0; day < state.monthLength; day++) {
    const td = document.createElement("td");
    td.className = "daily-done";
    td.dataset.dayIndex = String(day);
    doneRow.appendChild(td);
  }

  const progRow = document.createElement("tr");
  const progLabel = document.createElement("td");
  progLabel.textContent = "Progress %";
  progRow.appendChild(progLabel);

  for (let day = 0; day < state.monthLength; day++) {
    const td = document.createElement("td");
    td.className = "daily-progress";
    td.dataset.dayIndex = String(day);
    progRow.appendChild(td);
  }

  tfoot.appendChild(doneRow);
  tfoot.appendChild(progRow);
}

// Analysis table on the right
function renderAnalysisTable() {
  const tbody = document.querySelector("#analysisTable tbody");
  tbody.innerHTML = "";

  state.habits.forEach((habit) => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    const safeCat = (habit.category || "General").replace(/[^a-zA-Z0-9]/g, "");
    nameTd.innerHTML = `<span>${habit.name}</span> <br><span class="category-badge cat-${safeCat.toLowerCase()}" style="margin-top:0.25rem">${habit.category || "General"}</span>`;

    const goalTd = document.createElement("td");
    const goalInput = document.createElement("input");
    goalInput.type = "number";
    goalInput.min = "0";
    goalInput.max = String(state.monthLength);
    goalInput.value = String(habit.goal);
    goalInput.className = "goal-input";
    goalInput.dataset.habitId = habit.id;
    goalInput.addEventListener("change", onGoalChange);
    goalTd.appendChild(goalInput);

    const actualTd = document.createElement("td");
    actualTd.className = "habit-actual";
    actualTd.dataset.habitId = habit.id;
    actualTd.textContent = "0";

    const progressTd = document.createElement("td");
    const barBg = document.createElement("div");
    barBg.className = "bar-bg";
    const barFill = document.createElement("div");
    barFill.className = "bar-fill";
    barFill.dataset.habitId = habit.id;
    barBg.appendChild(barFill);
    progressTd.appendChild(barBg);

    tr.appendChild(nameTd);
    tr.appendChild(goalTd);
    tr.appendChild(actualTd);
    tr.appendChild(progressTd);

    tbody.appendChild(tr);
  });
}

const QUOTES = [
  "Small disciplines repeated with consistency every day lead to great achievements.",
  "You do not rise to the level of your goals. You fall to the level of your systems.",
  "Success is the product of daily habits—not once-in-a-lifetime transformations.",
  "First forget inspiration. Habit is more dependable.",
  "We are what we repeatedly do. Excellence, then, is not an act, but a habit.",
  "The secret of your future is hidden in your daily routine."
];

// ---------------- CALCULATIONS ----------------

function recalcAll() {
  const totalHabits = state.habits.length;
  const totalDays = state.monthLength;

  let totalDone = 0;
  const dayDone = new Array(totalDays).fill(0);

  state.habits.forEach((habit) => {
    habit.checks.forEach((val, day) => {
      if (val) {
        totalDone++;
        dayDone[day]++;
      }
    });
  });

  // header summary
  document.getElementById("numHabits").textContent = String(totalHabits);
  document.getElementById("completedHabits").textContent = String(totalDone);

  const totalPossible = totalHabits * totalDays;
  const overallPercent =
    totalPossible === 0 ? 0 : (totalDone / totalPossible) * 100;
  document.getElementById("overallProgress").textContent =
    overallPercent.toFixed(1) + "%";

  // calculate current streak (consecutive days with 100% completion)
  let streak = 0;
  const today = new Date();
  
  if (currentYear === today.getFullYear() && currentMonth === today.getMonth() + 1) {
    const currentDayIdx = today.getDate() - 1;
    
    // Start from yesterday. If today is also 100% complete, add it.
    if (totalHabits > 0 && dayDone[currentDayIdx] === totalHabits) {
      streak++;
    }
    
    // work backwards from yesterday
    for (let i = currentDayIdx - 1; i >= 0; i--) {
      if (totalHabits > 0 && dayDone[i] === totalHabits) {
        streak++;
      } else {
        break; // streak broken
      }
    }
  }
  
  const streakEl = document.getElementById("currentStreakStr");
  if (streakEl) {
    streakEl.textContent = `🔥 ${streak}`;
    if (streak > 0) {
      streakEl.classList.add("highlight");
      streakEl.style.color = "#f97316"; // orange glow
    } else {
      streakEl.classList.remove("highlight");
      streakEl.style.color = "";
    }
  }

  // Evaluate Gamified Badges
  // 1. First Step: > 0 completions
  if (totalDone > 0) {
    const badgeFirst = document.getElementById("badge-first-step");
    if (badgeFirst) badgeFirst.classList.remove("locked");
  }
  
  // 2. 3-Day Streak
  if (streak >= 3) {
    const badge3 = document.getElementById("badge-streak-3");
    if (badge3) badge3.classList.remove("locked");
  }
  
  // 3. 7-Day Warrior
  if (streak >= 7) {
    const badge7 = document.getElementById("badge-streak-7");
    if (badge7) badge7.classList.remove("locked");
  }

  // 4. Perfect Month (only if month is actually over OR if they literally did 100% so far,
  // but let's give it to them if they hit 100% on the month right now)
  if (totalPossible > 0 && totalDone === totalPossible) {
    const badgePerfect = document.getElementById("badge-perfect");
    if (badgePerfect) badgePerfect.classList.remove("locked");
  }

  // inject random quote if not already set
  const quoteEl = document.getElementById("dailyQuoteText");
  if (quoteEl && !quoteEl.dataset.initialized) {
    quoteEl.textContent = `"${QUOTES[Math.floor(Math.random() * QUOTES.length)]}"`;
    quoteEl.dataset.initialized = "true";
  }

  // daily rows
  document.querySelectorAll(".daily-done").forEach((td) => {
    const dayIndex = Number(td.dataset.dayIndex);
    td.textContent = String(dayDone[dayIndex] || 0);
  });

  document.querySelectorAll(".daily-progress").forEach((td) => {
    const dayIndex = Number(td.dataset.dayIndex);
    const percent =
      totalHabits === 0 ? 0 : (dayDone[dayIndex] / totalHabits) * 100;
    td.textContent = percent.toFixed(0) + "%";
  });

  // per-habit analysis
  updateAnalysis();
}

function updateAnalysis() {
  const totalDays = state.monthLength;

  state.habits.forEach((habit) => {
    const actual = habit.checks.filter(Boolean).length;

    const actualCell = document.querySelector(
      `.habit-actual[data-habit-id="${habit.id}"]`
    );
    if (actualCell) actualCell.textContent = String(actual);

    const bar = document.querySelector(
      `.bar-fill[data-habit-id="${habit.id}"]`
    );
    if (bar) {
      const denominator = habit.goal > 0 ? habit.goal : totalDays || 1;
      const percent = Math.min(100, (actual / denominator) * 100);
      bar.style.width = percent.toFixed(1) + "%";
    }
  });
}

// ---------------- EVENT HANDLERS ----------------

function onCheckboxChange(e) {
  const cb = e.target;
  const habitId = cb.dataset.habitId;
  const dayIndex = Number(cb.dataset.dayIndex);

  // Server-side/logic validation (already disabled in UI)
  const today = new Date();
  
  const isPastMonth = currentYear < today.getFullYear() || 
                     (currentYear === today.getFullYear() && currentMonth < today.getMonth() + 1);
  const isFutureMonth = currentYear > today.getFullYear() || 
                       (currentYear === today.getFullYear() && currentMonth > today.getMonth() + 1);

  const isPastDay = isPastMonth || 
                   (currentYear === today.getFullYear() && currentMonth === today.getMonth() + 1 && (dayIndex + 1) < today.getDate());
  const isFutureDay = isFutureMonth || 
                   (currentYear === today.getFullYear() && currentMonth === today.getMonth() + 1 && (dayIndex + 1) > today.getDate());

  if (isPastDay || isFutureDay) {
    e.preventDefault();
    cb.checked = !cb.checked; // revert
    alert(isPastDay ? "You cannot edit habits for past days." : "You cannot edit habits for future days.");
    return;
  }

  const habit = state.habits.find((h) => h.id === habitId);
  if (!habit) return;

  habit.checks[dayIndex] = cb.checked;
  debouncedSave();
  recalcAll();
}

function onGoalChange(e) {
  const input = e.target;
  const habitId = input.dataset.habitId;
  let value = Number(input.value);
  if (Number.isNaN(value) || value < 0) value = 0;
  if (value > state.monthLength) value = state.monthLength;
  input.value = String(value);

  const habit = state.habits.find((h) => h.id === habitId);
  if (!habit) return;

  habit.goal = value;
  debouncedSave();
  recalcAll();
}

function editHabitName(habitId) {
  const habit = state.habits.find((h) => h.id === habitId);
  if (!habit) return;

  const newName = prompt("Edit habit name:", habit.name);
  if (newName === null) return; // cancelled
  const trimmed = newName.trim();
  if (!trimmed) return;

  habit.name = trimmed;
  debouncedSave();
  renderAll();
}

function deleteHabit(habitId) {
  if (!confirm("Delete this habit? Progress for it will be lost.")) return;
  state.habits = state.habits.filter((h) => h.id !== habitId);
  debouncedSave();
  renderAll();
}

// ---------------- CONTROLS ----------------

function initControls() {
  // add habit
  const form = document.getElementById("addHabitForm");
  const input = document.getElementById("newHabitName");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    
    const categorySelect = document.getElementById("newHabitCategory");
    const category = categorySelect ? categorySelect.value : "General";

    const newHabit = {
      id: createId(),
      name,
      category,
      goal: state.monthLength,
      checks: Array(state.monthLength).fill(false)
    };
    state.habits.push(newHabit);
    input.value = "";
    debouncedSave();
    renderAll();
  });

  // prev / next / direct / today month navigation
  document.getElementById("prevMonthBtn").addEventListener("click", () => navigateMonth(-1));
  document.getElementById("nextMonthBtn").addEventListener("click", () => {
    const today = new Date();
    const isAtCurrent = currentYear === today.getFullYear() && currentMonth === today.getMonth() + 1;
    if (!isAtCurrent) navigateMonth(1);
  });
  
  const monthPicker = document.getElementById("monthPicker");
  if (monthPicker) {
    monthPicker.addEventListener("change", (e) => {
      if (!e.target.value) {
        // user cleared the native picker somehow, revert UI
        renderHeaderInputs(); 
        return;
      }
      const [y, m] = e.target.value.split("-");
      currentYear = parseInt(y, 10);
      currentMonth = parseInt(m, 10);
      switchMonth();
    });
  }

  document.getElementById("todayBtn").addEventListener("click", () => {
    const today = new Date();
    if (currentYear !== today.getFullYear() || currentMonth !== today.getMonth() + 1) {
      currentYear = today.getFullYear();
      currentMonth = today.getMonth() + 1;
      switchMonth();
    }
  });

  // Reset Modal Logic
  const resetModal = document.getElementById("resetModal");
  
  document.getElementById("resetAllBtn").addEventListener("click", () => {
    resetModal.setAttribute("aria-hidden", "false");
  });

  document.getElementById("cancelResetBtn").addEventListener("click", () => {
    resetModal.setAttribute("aria-hidden", "true");
  });

  document.getElementById("resetCurrentBtn").addEventListener("click", async () => {
    resetModal.setAttribute("aria-hidden", "true");
    
    // Load default student habits
    state = {
      monthLength: getDaysInMonth(currentYear, currentMonth),
      habits: [
        { id: createId(), name: "Study 2 hrs", goal: getDaysInMonth(currentYear, currentMonth), checks: Array(getDaysInMonth(currentYear, currentMonth)).fill(false) },
        { id: createId(), name: "Read 10 pages", goal: Math.min(20, getDaysInMonth(currentYear, currentMonth)), checks: Array(getDaysInMonth(currentYear, currentMonth)).fill(false) },
        { id: createId(), name: "Drink 2L Water", goal: getDaysInMonth(currentYear, currentMonth), checks: Array(getDaysInMonth(currentYear, currentMonth)).fill(false) },
        { id: createId(), name: "Sleep 8 hrs", goal: getDaysInMonth(currentYear, currentMonth), checks: Array(getDaysInMonth(currentYear, currentMonth)).fill(false) },
        { id: createId(), name: "Exercise 30m", goal: Math.min(15, getDaysInMonth(currentYear, currentMonth)), checks: Array(getDaysInMonth(currentYear, currentMonth)).fill(false) }
      ]
    };

    try { await saveState(); } catch (err) { console.error(err); }
    renderAll();
  });

  document.getElementById("resetAllHistoryBtn").addEventListener("click", async () => {
    if (!confirm("Are you absolutely SURE? This will permanently delete ALL data from the cloud for every single month. This cannot be undone.")) return;
    
    resetModal.setAttribute("aria-hidden", "true");
    
    try {
      await authFetch(`/months/all`, { method: "DELETE" });
    } catch(err) { console.error("Wipe all failed", err); }
    
    // Load default student habits so the screen isn't fully empty
    state = {
      monthLength: getDaysInMonth(currentYear, currentMonth),
      habits: [
        { id: createId(), name: "Study 2 hrs", goal: getDaysInMonth(currentYear, currentMonth), checks: Array(getDaysInMonth(currentYear, currentMonth)).fill(false) },
        { id: createId(), name: "Read 10 pages", goal: Math.min(20, getDaysInMonth(currentYear, currentMonth)), checks: Array(getDaysInMonth(currentYear, currentMonth)).fill(false) },
        { id: createId(), name: "Drink 2L Water", goal: getDaysInMonth(currentYear, currentMonth), checks: Array(getDaysInMonth(currentYear, currentMonth)).fill(false) },
        { id: createId(), name: "Sleep 8 hrs", goal: getDaysInMonth(currentYear, currentMonth), checks: Array(getDaysInMonth(currentYear, currentMonth)).fill(false) },
        { id: createId(), name: "Exercise 30m", goal: Math.min(15, getDaysInMonth(currentYear, currentMonth)), checks: Array(getDaysInMonth(currentYear, currentMonth)).fill(false) }
      ]
    };

    try { await saveState(); } catch (err) { }
    renderAll();
  });

  // manual save button
  const saveBtn = document.getElementById("saveBtn");
  const saveStatus = document.getElementById("saveStatus");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      try {
        saveBtn.disabled = true;
        if (saveStatus) saveStatus.textContent = "Saving...";
        await saveState();
        if (saveStatus) {
          saveStatus.textContent = "Saved";
          setTimeout(() => {
            saveStatus.textContent = "";
          }, 1500);
        }
      } catch (err) {
        console.error("Manual save failed:", err);
        if (saveStatus) saveStatus.textContent = "Save failed";
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  // sidebar nav tabs
  const navItems = document.querySelectorAll(".sidebar-nav .nav-item, .nav-bottom .nav-item");
  const mobileNavItems = document.querySelectorAll(".mobile-nav-item");
  const tabs = [
    document.getElementById("overviewTab"),
    document.getElementById("habitsTab"),
    document.getElementById("analyticsTab"),
    document.getElementById("profileTab")
  ];

  // unified tab-switching logic
  function goToTab(index) {
    // update tabs
    tabs.forEach((t, idx) => {
      if (t) {
        if (idx === index) t.classList.add("active");
        else t.classList.remove("active");
      }
    });

    // update desktop sidebar
    navItems.forEach((n, idx) => {
      const btnTab = n.hasAttribute("data-tab") ? parseInt(n.dataset.tab, 10) : idx;
      if (btnTab === index) {
        n.classList.add("nav-item-active");
        const dot = n.querySelector(".nav-dot");
        if (dot) dot.classList.remove("muted");
      } else {
        n.classList.remove("nav-item-active");
        const dot = n.querySelector(".nav-dot");
        if (dot) dot.classList.add("muted");
      }
    });

    // update mobile nav
    mobileNavItems.forEach(n => {
      const btnTab = parseInt(n.dataset.tab, 10);
      n.classList.toggle("active", btnTab === index);
    });

    // hide the calendar header if on the Profile tab (index 3)
    const topBar = document.querySelector(".top-bar");
    if (topBar) {
      topBar.style.display = index === 3 ? "none" : "flex";
    }
  }

  navItems.forEach((btn, i) => {
    btn.addEventListener("click", () => {
      const tabIndex = btn.hasAttribute("data-tab") ? parseInt(btn.dataset.tab, 10) : i;
      goToTab(tabIndex);
    });
  });

  mobileNavItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabIndex = parseInt(btn.dataset.tab, 10);
      goToTab(tabIndex);
    });
  });
}

function adjustMonthLength(newLength) {
  const oldLength = state.monthLength;
  state.monthLength = newLength;

  state.habits.forEach((habit) => {
    const checks = habit.checks.slice(0, newLength);
    while (checks.length < newLength) {
      checks.push(false);
    }
    habit.checks = checks;
    if (habit.goal > newLength) habit.goal = newLength;
  });
}

// -------- LOGOUT & PROFILE --------

function initLogout() {
  const logoutConfirmBtn = document.getElementById("logoutConfirmBtn");
  if (logoutConfirmBtn) {
    logoutConfirmBtn.addEventListener("click", () => {
      if (confirm("Are you sure you want to sign out?")) {
        localStorage.removeItem(TOKEN_KEY);
        window.location.href = "auth.html";
      }
    });
  }

  const exportDataBtn = document.getElementById("exportDataBtn");
  if (exportDataBtn) {
    exportDataBtn.addEventListener("click", exportDataToCSV);
  }
}

function initThemeToggle() {
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  const themeIcon = document.getElementById("themeIcon");
  const themeLabelText = document.getElementById("themeLabelText");
  
  // Load saved theme
  const savedTheme = localStorage.getItem("focusboard_theme");
  if (savedTheme === "light") {
    document.body.classList.add("light-theme");
    if (themeIcon) themeIcon.textContent = "🌙";
    if (themeLabelText) themeLabelText.textContent = "Switch to Dark Theme.";
  }
  
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const isLight = document.body.classList.toggle("light-theme");
      if (isLight) {
        localStorage.setItem("focusboard_theme", "light");
        if (themeIcon) themeIcon.textContent = "🌙";
        if (themeLabelText) themeLabelText.textContent = "Switch to Dark Theme.";
      } else {
        localStorage.setItem("focusboard_theme", "dark");
        if (themeIcon) themeIcon.textContent = "☀️";
        if (themeLabelText) themeLabelText.textContent = "Switch to Light Theme.";
      }
      // Re-render chart to pick up new theme colors
      renderChart();
    });
  }
}

// ---------------- NOTIFICATIONS ----------------

let notificationInterval = null;
let hasNotifiedToday = false;

function initNotifications() {
  const notifyBtn = document.getElementById("notifyToggleBtn");
  const notifyIcon = document.getElementById("notifyIcon");
  const notifyLabelText = document.getElementById("notifyLabelText");
  
  const savedPref = localStorage.getItem("focusboard_notify");
  const isEnabled = savedPref === "true" && Notification.permission === "granted";
  
  const updateUI = (enabled) => {
    if (notifyLabelText) notifyLabelText.textContent = enabled ? "Daily reminders are active (8:00 PM)." : "Enable 8:00 PM uncompleted habit alerts.";
    if (notifyIcon) notifyIcon.textContent = enabled ? "🔕" : "🔔";
    if (notifyBtn) notifyBtn.classList.toggle("outline-btn", enabled);
  };
  
  updateUI(isEnabled);
  if (isEnabled) startNotificationChecker();
  
  if (notifyBtn) {
    notifyBtn.addEventListener("click", async () => {
      const currentPref = localStorage.getItem("focusboard_notify") === "true";
      
      if (currentPref) {
        // Turn off
        localStorage.setItem("focusboard_notify", "false");
        updateUI(false);
        if (notificationInterval) clearInterval(notificationInterval);
      } else {
        // Turn on
        if (!("Notification" in window)) {
          alert("This browser does not support desktop notification");
          return;
        }
        
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
          localStorage.setItem("focusboard_notify", "true");
          updateUI(true);
          startNotificationChecker();
        } else {
          alert("You must allow notification permissions in your browser to use this feature.");
        }
      }
    });
  }
}

function startNotificationChecker() {
  if (notificationInterval) clearInterval(notificationInterval);
  
  // Check every 5 minutes
  notificationInterval = setInterval(() => {
    const today = new Date();
    // Reset daily flag at midnight
    if (today.getHours() === 0) hasNotifiedToday = false;
    
    // IF 8:XX PM (20) AND we haven't notified today
    if (today.getHours() >= 20 && !hasNotifiedToday) {
      // Are we currently looking at the present month?
      const isCurrentMonth = currentYear === today.getFullYear() && currentMonth === today.getMonth() + 1;
      if (isCurrentMonth) {
        const todayIndex = today.getDate() - 1;
        
        let pending = 0;
        state.habits.forEach(h => {
          if (!h.checks[todayIndex]) pending++;
        });
        
        if (pending > 0) {
          hasNotifiedToday = true;
          new Notification("FocusBoard Reminder", {
            body: `You still have ${pending} habit${pending > 1 ? 's' : ''} left to complete today. Keep the streak alive!`,
            icon: "favicon.ico"
          });
        }
      }
    }
  }, 1000 * 60 * 5);
}

async function exportDataToCSV() {
  const btn = document.getElementById("exportDataBtn");
  const originalText = btn.innerHTML;
  btn.innerHTML = "<em>Exporting...</em>";
  btn.disabled = true;

  try {
    const res = await authFetch(`/months/all`);
    if (!res || !res.ok) throw new Error("Failed to fetch data");
    
    const allMonths = await res.json();
    if (!allMonths || allMonths.length === 0) {
      alert("No data found to export.");
      return;
    }

    // Convert JSON to CSV
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Year,Month,Habit,Goal,Completed Days,Total Days\n";

    allMonths.forEach(month => {
      if (month.habits) {
        month.habits.forEach(habit => {
          const completedCount = habit.checks ? habit.checks.filter(Boolean).length : 0;
          // Escape quotes in habit name
          const safeName = `"${habit.name.replace(/"/g, '""')}"`;
          row = `${month.year},${month.month},${safeName},${habit.goal},${completedCount},${month.monthLength}\n`;
          csvContent += row;
        });
      }
    });

    // Trigger download
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `HabitTracker_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link); // Required for FF
    link.click();
    document.body.removeChild(link);
    
  } catch (err) {
    console.error("Export failed:", err);
    alert("Failed to export data.");
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

// -------- CHART RENDERING --------

let overviewChart = null;

function renderChart() {
  const canvas = document.getElementById("overviewChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  // Calculate daily totals across all habits
  const labels = Array.from({ length: state.monthLength }, (_, i) => i + 1);
  const data = Array(state.monthLength).fill(0);

  state.habits.forEach(h => {
    for (let i = 0; i < state.monthLength; i++) {
      if (h.checks[i]) data[i]++;
    }
  });

  if (overviewChart) {
    const isLight = document.body.classList.contains("light-theme");
    overviewChart.data.labels = labels;
    overviewChart.data.datasets[0].data = data;
    
    // Update theme-dependent colors
    overviewChart.data.datasets[0].pointBackgroundColor = isLight ? "#ffffff" : "#020617";
    overviewChart.data.datasets[0].pointBorderColor = "#10b981";
    overviewChart.data.datasets[0].borderColor = "#10b981";
    overviewChart.data.datasets[0].backgroundColor = "rgba(16, 185, 129, 0.1)";

    overviewChart.options.scales.x.grid.color = isLight ? "rgba(0,0,0,0.05)" : "rgba(148, 163, 184, 0.05)";
    overviewChart.options.scales.y.grid.color = isLight ? "rgba(0,0,0,0.05)" : "rgba(148, 163, 184, 0.1)";
    overviewChart.options.scales.x.ticks.color = isLight ? "#64748b" : "#6b7280";
    overviewChart.options.scales.y.ticks.color = isLight ? "#64748b" : "#9ca3af";
    overviewChart.options.plugins.tooltip.backgroundColor = isLight ? "rgba(255,255,255,0.95)" : "rgba(15, 23, 42, 0.95)";
    overviewChart.options.plugins.tooltip.titleColor = isLight ? "#1f2937" : "#9ca3af";
    overviewChart.options.plugins.tooltip.bodyColor = isLight ? "#1f2937" : "#e5e7eb";

    overviewChart.update();
    return;
  }

  const isLight = document.body.classList.contains("light-theme");

  // Create new chart
  overviewChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Habits Completed",
        data,
        borderColor: "#22c55e",
        backgroundColor: "rgba(34, 197, 94, 0.15)",
        borderWidth: 2,
        pointBackgroundColor: isLight ? "#ffffff" : "#020617",
        pointBorderColor: "#22c55e",
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: isLight ? "rgba(255, 255, 255, 0.95)" : "rgba(15, 23, 42, 0.95)",
          titleColor: isLight ? "#1f2937" : "#9ca3af",
          bodyColor: isLight ? "#1f2937" : "#e5e7eb",
          borderColor: "rgba(148, 163, 184, 0.2)",
          borderWidth: 1,
          padding: 10,
          displayColors: false,
          callbacks: {
            title: (items) => `Day ${items[0].label}`,
            label: (item) => `${item.raw} completed`
          }
        }
      },
      scales: {
        x: {
          grid: { color: isLight ? "rgba(0,0,0,0.05)" : "rgba(148, 163, 184, 0.05)" },
          ticks: { color: isLight ? "#64748b" : "#6b7280", maxTicksLimit: 15 }
        },
        y: {
          beginAtZero: true,
          suggestedMax: Math.max(3, state.habits.length),
          ticks: { stepSize: 1, color: isLight ? "#64748b" : "#9ca3af" },
          grid: { color: isLight ? "rgba(0,0,0,0.05)" : "rgba(148, 163, 184, 0.1)" }
        }
      }
    }
  });
}

// -------- MONTH NAVIGATION --------

function navigateMonth(delta) {
  let m = currentMonth + delta;
  let y = currentYear;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  currentYear = y;
  currentMonth = m;
  switchMonth();
}

async function switchMonth() {
  // reset state for new month
  state = {
    monthLength: getDaysInMonth(currentYear, currentMonth),
    habits: []
  };

  showLoading(true);
  try {
    await loadState();
  } finally {
    showLoading(false);
  }

  renderAll();
}

// ---------------- STORAGE ----------------

async function saveState() {
  try {
    const payload = {
      year: currentYear,
      month: currentMonth,
      monthLength: state.monthLength,
      title: MONTH_NAMES[currentMonth - 1],
      habits: state.habits.map((h) => ({
        habitId: h.id,
        name: h.name,
        goal: h.goal,
        checks: h.checks
      }))
    };

    const res = await authFetch(`/months/save`, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (res && !res.ok) {
      console.warn("Failed to save state to server", await res.text());
    }
  } catch (err) {
    console.error("saveState error:", err);
  }
}


async function loadState() {
  try {
    const res = await authFetch(`/months/${currentYear}/${currentMonth}`);
    if (!res) return;

    // if no data for this month, AND it's not in the past, inject default student habits
    const today = new Date();
    const isPastMonth = currentYear < today.getFullYear() || 
                       (currentYear === today.getFullYear() && currentMonth < today.getMonth() + 1);
                       
    if (!res.ok) {
      state.monthLength = getDaysInMonth(currentYear, currentMonth);
      
      if (!isPastMonth) {
        state.habits = [
          { id: createId(), name: "Study 2 hrs", goal: state.monthLength, checks: Array(state.monthLength).fill(false) },
          { id: createId(), name: "Read 10 pages", goal: Math.min(20, state.monthLength), checks: Array(state.monthLength).fill(false) },
          { id: createId(), name: "Drink 2L Water", goal: state.monthLength, checks: Array(state.monthLength).fill(false) },
          { id: createId(), name: "Sleep 8 hrs", goal: state.monthLength, checks: Array(state.monthLength).fill(false) },
          { id: createId(), name: "Exercise 30m", goal: Math.min(15, state.monthLength), checks: Array(state.monthLength).fill(false) }
        ];
        // Auto-save these so they persist on the cloud immediately
        await saveState();
      } else {
        // Leave past months empty if they have no data
        state.habits = [];
      }
      return;
    }

    const data = await res.json();
    if (!data) return;

    state.monthLength = getDaysInMonth(currentYear, currentMonth);
    state.habits = (data.habits || []).map((h) => ({
      id: h.habitId || h._id || createId(),
      name: h.name || "",
      goal: h.goal || state.monthLength,
      checks: Array.isArray(h.checks)
        ? h.checks.slice(0, state.monthLength).concat(Array(Math.max(0, state.monthLength - h.checks.length)).fill(false))
        : Array(state.monthLength).fill(false)
    }));
  } catch (err) {
    console.error("loadState error:", err);
  }
}


// ---------------- UTIL ----------------

function createId() {
  // simple id generator
  return (
    Date.now().toString(36) +
    Math.random().toString(36).substring(2, 8)
  );
}
