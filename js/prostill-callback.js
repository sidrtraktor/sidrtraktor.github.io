(function () {
  "use strict";

  function setStatus(form, message, type) {
    var status = form.querySelector(".pro-callback-status");
    if (!status) return;
    status.className = "pro-callback-status" + (type ? " is-" + type : "");
    status.textContent = message;
  }

  function isPreview() {
    var mode = document.querySelector('meta[name="prostill-site-mode"]');
    var hostname = window.location.hostname;
    return (mode && mode.content === "preview") ||
      hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      hostname.endsWith(".github.io") ||
      window.location.protocol === "file:";
  }

  function closeModal(form) {
    var modal = form.closest(".modal-okno");
    var overlay = document.querySelector(".js-overlay-modal");
    if (modal) modal.classList.remove("active");
    if (overlay) overlay.classList.remove("active");
  }

  document.addEventListener("submit", async function (event) {
    var form = event.target.closest("[data-prostill-callback]");
    if (!form) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (!form.reportValidity()) return;

    var submit = form.querySelector(".pro-callback-submit");
    var originalText = submit ? submit.textContent : "Отправить";
    var data = new FormData(form);
    var phone = String(data.get("phone") || "").trim();

    if (phone.replace(/\D/g, "").length < 7) {
      setStatus(form, "Проверьте номер телефона.", "error");
      form.querySelector('[name="phone"]').focus();
      return;
    }

    if (submit) {
      submit.disabled = true;
      submit.textContent = "Отправляем…";
    }
    setStatus(form, "", "");

    try {
      if (isPreview()) {
        await new Promise(function (resolve) { window.setTimeout(resolve, 450); });
        setStatus(form, "Демо-режим: форма проверена. На рабочем хостинге заявка уйдёт в MAX и на info@prostill.ru.", "warning");
        return;
      }

      var response = await fetch(form.action, {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          name: String(data.get("name") || "").trim(),
          phone: phone,
          consent: data.get("consent") === "1",
          website: String(data.get("website") || ""),
          page: window.location.href
        })
      });
      var result = await response.json().catch(function () { return {}; });

      if (!response.ok || result.status === "error") {
        throw new Error(result.message || "Не удалось отправить заявку");
      }

      if (result.status === "partial") {
        setStatus(form, "Заявка отправлена. Один из каналов уведомления временно недоступен.", "warning");
      } else {
        setStatus(form, "Спасибо! Заявка отправлена в MAX и на почту.", "success");
      }
      form.reset();
      window.setTimeout(function () { closeModal(form); }, 1800);
    } catch (error) {
      setStatus(form, "Не удалось отправить заявку. Позвоните нам или напишите в MAX.", "error");
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = originalText;
      }
    }
  }, true);
}());
