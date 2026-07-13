(function () {
  const form = document.getElementById("entry-form");
  const submitBtn = document.getElementById("submit-btn");
  const statusEl = document.getElementById("form-status");
  const QUESTION_COUNT = 10;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const privacyDialog = document.getElementById("privacy-dialog");
  const openPrivacyBtn = document.getElementById("open-privacy");
  const closePrivacyBtn = document.getElementById("close-privacy");

  if (privacyDialog && openPrivacyBtn && closePrivacyBtn) {
    openPrivacyBtn.addEventListener("click", () => privacyDialog.showModal());
    closePrivacyBtn.addEventListener("click", () => privacyDialog.close());
    privacyDialog.addEventListener("click", (e) => {
      const rect = privacyDialog.getBoundingClientRect();
      const insideDialog =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!insideDialog) privacyDialog.close();
    });
  }

  function setError(fieldName, message) {
    const el = form.querySelector(`[data-error-for="${fieldName}"]`);
    if (el) el.textContent = message || "";
  }

  function clearErrors() {
    form.querySelectorAll(".error").forEach((el) => (el.textContent = ""));
    form.querySelectorAll("fieldset.invalid").forEach((el) => el.classList.remove("invalid"));
  }

  function validate() {
    clearErrors();
    let firstInvalid = null;
    const errors = [];

    const name = form.name.value.trim();
    if (!name) {
      setError("name", "A név megadása kötelező.");
      errors.push("name");
      firstInvalid = firstInvalid || form.name;
    }

    const email = form.email.value.trim();
    if (!email || !EMAIL_RE.test(email)) {
      setError("email", "Érvényes e-mail cím megadása kötelező.");
      errors.push("email");
      firstInvalid = firstInvalid || form.email;
    }

    const answers = [];
    for (let i = 1; i <= QUESTION_COUNT; i++) {
      const name_ = `q${i}`;
      const checked = form.querySelector(`input[name="${name_}"]:checked`);
      if (!checked) {
        setError(name_, "Kötelező válaszolni erre a kérdésre.");
        const fieldset = form.querySelector(`fieldset[data-question="${i}"]`);
        if (fieldset) fieldset.classList.add("invalid");
        errors.push(name_);
        firstInvalid = firstInvalid || form.querySelector(`input[name="${name_}"]`);
      } else {
        answers.push(checked.value);
      }
    }

    const privacyAccepted = form.privacy.checked;
    if (!privacyAccepted) {
      setError("privacy", "Az adatvédelmi tájékoztató elfogadása kötelező.");
      errors.push("privacy");
      firstInvalid = firstInvalid || form.privacy;
    }

    return { valid: errors.length === 0, firstInvalid, name, email, answers, privacyAccepted };
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    statusEl.textContent = "";
    statusEl.className = "form-status";

    const result = validate();
    if (!result.valid) {
      if (result.firstInvalid) result.firstInvalid.focus();
      statusEl.textContent = "Kérjük, javítsd a pirossal jelölt hibákat.";
      statusEl.classList.add("error");
      return;
    }

    submitBtn.disabled = true;
    statusEl.textContent = "Küldés folyamatban...";

    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: result.name,
          email: result.email,
          answers: result.answers,
          privacyAccepted: result.privacyAccepted,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        statusEl.textContent = (data.errors && data.errors[0]) || "Hiba történt a beküldés során.";
        statusEl.classList.add("error");
        submitBtn.disabled = false;
        return;
      }

      form.innerHTML = '<p class="form-status success">Köszönjük a részvételt! Sikeresen beküldted a válaszaidat a nyereményjátékba.</p>';
    } catch (err) {
      statusEl.textContent = "Hálózati hiba történt. Kérjük, próbáld újra.";
      statusEl.classList.add("error");
      submitBtn.disabled = false;
    }
  });
})();
