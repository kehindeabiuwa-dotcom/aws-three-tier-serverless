// Replace this with the API Gateway Invoke URL from your CloudFormation stack Outputs
// e.g. https://abc123.execute-api.eu-north-1.amazonaws.com/prod/users
const API_URL = "https://YOUR-API-ID.execute-api.YOUR-REGION.amazonaws.com/prod/users";

async function fetchUser() {
  const userId = document.getElementById("userId").value.trim();
  const resultEl = document.getElementById("result");
  const btn = document.getElementById("fetchBtn");

  resultEl.className = "result hidden";
  resultEl.innerHTML = "";

  if (!userId) {
    showResult("error", "Please enter a User ID.");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Fetching…";

  try {
    const res = await fetch(`${API_URL}?userId=${encodeURIComponent(userId)}`);
    const data = await res.json();

    if (!res.ok) {
      showResult("error", `Error ${res.status}: ${data.error ?? "Unknown error"}`);
      return;
    }

    showResult("success", JSON.stringify(data, null, 2));
  } catch (err) {
    showResult("error", `Network error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Get User Data";
  }
}

function showResult(type, text) {
  const el = document.getElementById("result");
  el.className = `result ${type}`;
  el.innerHTML = `<pre>${escapeHtml(text)}</pre>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Allow pressing Enter in the input
document.getElementById("userId").addEventListener("keydown", (e) => {
  if (e.key === "Enter") fetchUser();
});
