(() => {
  const api = async (path, options = {}) => {
    const response = await fetch(`/api${path}`, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "Unable to load the game.");
      error.status = response.status;
      throw error;
    }
    return data;
  };
  const setup = document.querySelector("#game-setup");
  if (!setup) return;

  let game;
  let index = 0;
  const answers = [];
  let renderedAt = 0;
  const card = document.querySelector("#question-card");
  const result = document.querySelector("#game-result");
  const status = document.querySelector("#game-status");

  function displayQuestion() {
    const question = game.questions[index];
    renderedAt = performance.now();
    document.querySelector("#question-count").textContent = `Question ${index + 1} of 10`;
    document.querySelector("#progress-fill").style.width = `${(index + 1) * 10}%`;
    document.querySelector("#difficulty").textContent = question.difficulty;
    const image = document.querySelector("#question-image");
    image.src = question.image;
    image.alt = "Scene for the Irish sentence question";
    const answersContainer = document.querySelector("#answer-options");
    answersContainer.replaceChildren();
    question.options.forEach((option, choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "answer-option";
      button.innerHTML = `<span class="answer-letter">${String.fromCharCode(65 + choice)}</span><span>${escapeHtml(option)}</span>`;
      button.addEventListener("click", () => chooseAnswer(choice));
      answersContainer.append(button);
    });
  }

  function chooseAnswer(choice) {
    const clickedAt = performance.now();
    const question = game.questions[index];
    answers.push({
      questionId: question.id,
      choice,
      renderedAt: Math.round(renderedAt),
      clickedAt: Math.round(clickedAt),
    });
    if (index < 9) {
      index += 1;
      displayQuestion();
    } else {
      finish();
    }
  }

  async function finish() {
    card.hidden = true;
    status.textContent = "Checking your answers…";
    try {
      const outcome = await api("/game/submit", {
        method: "POST",
        body: JSON.stringify({ sessionId: game.sessionId, answers }),
      });
      status.textContent = "";
      result.hidden = false;
      document.querySelector("#final-score").textContent = outcome.score.toLocaleString();
      document.querySelector("#result-breakdown").textContent =
        `${outcome.correctCount} exact answers · ${outcome.answers.filter((item) => item.close && !item.correct).length} close answers`;
      localStorage.setItem("gaelgraph.daily", JSON.stringify({
        date: new Date().toISOString().slice(0, 10), score: outcome.score,
      }));
    } catch (error) {
      if (error.status === 409) {
        try {
          const latest = await api("/game");
          if (latest.played) {
            status.textContent = "";
            showPlayed(latest.score);
            return;
          }
        } catch (refreshError) {
          status.textContent = refreshError.message;
          return;
        }
      }
      status.textContent = error.message;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "button subtle";
      retry.textContent = "Retry score submission";
      retry.addEventListener("click", () => finish(), { once: true });
      status.append(" ", retry);
    }
  }

  function showPlayed(score) {
    card.hidden = true;
    setup.hidden = true;
    result.hidden = false;
    document.querySelector("#result-title").textContent = "You've played today";
    document.querySelector("#final-score").textContent = Number(score).toLocaleString();
    document.querySelector("#result-breakdown").textContent = "Your score is on today's leaderboard.";
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[character]));
  }

  document.addEventListener("profile:ready", async () => {
    try {
      game = await api("/game");
      if (game.played) {
        showPlayed(game.score);
        return;
      }
      document.querySelector("#game-start").addEventListener("click", () => {
        setup.hidden = true;
        card.hidden = false;
        displayQuestion();
      }, { once: true });
    } catch (error) {
      status.textContent = error.message;
    }
  }, { once: true });
})();
