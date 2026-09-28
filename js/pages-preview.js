(() => {
  const message = "Эта форма требует рабочего PHP-хостинга. В публичной демонстрации отправка отключена.";
  document.addEventListener("submit", (event) => {
    if (!event.target.matches(".rd-mailform, .rd-search")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.alert(message);
  }, true);
})();
