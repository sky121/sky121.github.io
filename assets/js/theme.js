const themeButton = document.getElementById("theme");
const learnButton = document.getElementsByClassName("shift-button");
const cards = document.getElementsByClassName("card-shift");
let theme = localStorage.getItem("Theme");
const body = document.body;
if (theme) {
  if (theme == "light") {
    body.classList.replace("dark", theme);
    themeButton.innerText = "Light Theme";
    for (var i = 0; i < learnButton.length; i++) {
      learnButton[i].classList.replace("btn-outline-light", "btn-outline-dark");
    }
  } else {
    body.classList.replace("light", theme);
    themeButton.innerText = "Dark Theme";
    for (var i = 0; i < learnButton.length; i++) {
      learnButton[i].classList.replace("btn-outline-dark", "btn-outline-light");
    }
  }
}
themeButton.onclick = () => {
  if (body.classList.contains("light")) {
    body.classList.replace("light", "dark");
    localStorage.setItem("Theme", "dark");
    themeButton.innerText = "Dark Theme";
    for (var i = 0; i < learnButton.length; i++) {
      learnButton[i].classList.replace("btn-outline-dark", "btn-outline-light");
    }
  } else {
    body.classList.replace("dark", "light");
    localStorage.setItem("Theme", "light");
    themeButton.innerText = "Light Theme";

    for (var i = 0; i < learnButton.length; i++) {
      learnButton[i].classList.replace("btn-outline-light", "btn-outline-dark");
    }
  }
};
