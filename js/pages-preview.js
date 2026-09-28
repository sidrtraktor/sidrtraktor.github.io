(() => {
  const message = "Формы и серверный поиск отключены в демонстрационной версии. Свяжитесь с нами по телефону или через мессенджер.";
  document.addEventListener("submit", (event) => {
    if (!event.target.matches(".rd-mailform, .rd-search")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.alert(message);
  }, true);
})();
