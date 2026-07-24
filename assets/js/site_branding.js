if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", addCascadiaProductMark, { once: true });
} else {
  addCascadiaProductMark();
}

function addCascadiaProductMark() {
  if (document.querySelector("[data-cascadia-product-mark]")) return;

  const footer = document.createElement("footer");
  footer.className = "cascadia-product-footer";
  footer.dataset.cascadiaProductMark = "true";

  const link = document.createElement("a");
  link.href = "https://www.cascadiaseaweed.com/naturebasedsolutions";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", "Cascadia Seaweed nature-based solutions");

  const logo = document.createElement("img");
  logo.src = "./assets/images/cascadia-seaweed-logo.png";
  logo.alt = "Cascadia Seaweed";

  const label = document.createElement("span");
  label.textContent = "Nature-based solutions product";

  link.append(logo, label);
  footer.append(link);
  document.body.append(footer);
}
