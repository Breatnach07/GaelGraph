(() => {
  const counties = [
    "Antrim", "Armagh", "Carlow", "Cavan", "Clare", "Cork", "Derry", "Donegal",
    "Down", "Dublin", "Fermanagh", "Galway", "Kerry", "Kildare", "Kilkenny",
    "Laois", "Leitrim", "Limerick", "Longford", "Louth", "Mayo", "Meath",
    "Monaghan", "Offaly", "Roscommon", "Sligo", "Tipperary", "Tyrone",
    "Waterford", "Westmeath", "Wexford", "Wicklow",
  ];
  const regions = ["Europe", "North America", "South America", "Asia", "Africa", "Middle East"];
  let profile = null;

  async function api(path, options = {}) {
    const response = await fetch(`/api${path}`, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...options.headers },
      ...options,
    });
    if (response.status === 204) return null;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || "Something went wrong.");
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function showStatus(element, message) {
    if (element) element.textContent = message || "";
  }

  function renderProfile() {
    const name = document.querySelector("[data-profile-name]");
    const avatar = document.querySelector("[data-profile-avatar]");
    if (name) name.textContent = profile.display_name;
    if (avatar && profile.picture_url) {
      avatar.src = profile.picture_url;
      avatar.alt = "";
      avatar.hidden = false;
    }
    const userId = document.querySelector("[data-user-id]");
    if (userId) userId.textContent = profile.user_id;
    document.querySelectorAll("[data-authenticated]").forEach((el) => { el.hidden = false; });
    document.querySelectorAll("[data-unauthenticated]").forEach((el) => { el.hidden = true; });
  }

  function setupRegionForm() {
    const form = document.querySelector("#region-form");
    if (!form) return;
    const type = form.elements.regionType;
    const region = form.elements.regionName;
    const populate = () => {
      const options = type.value === "ireland" ? counties : regions;
      region.replaceChildren(...options.map((name) => new Option(name, name)));
      const submit = form.querySelector("[type=submit]");
      submit.disabled = false;
    };
    type.addEventListener("change", populate);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector(".status");
      const button = form.querySelector("[type=submit]");
      button.disabled = true;
      showStatus(status, "");
      try {
        const saved = await api("/profile/region", {
          method: "PUT",
          body: JSON.stringify({ regionType: type.value, regionName: region.value }),
        });
        profile.region_type = saved.regionType;
        profile.region_name = saved.regionName;
        document.querySelector("#region-modal").hidden = true;
        document.dispatchEvent(new CustomEvent("profile:ready", { detail: profile }));
      } catch (error) {
        showStatus(status, error.message);
        button.disabled = false;
      }
    });
    populate();
  }

  async function loadProfile() {
    const protectedPage = document.body.dataset.protected === "true";
    try {
      const result = await api("/me");
      profile = result.profile;
      localStorage.setItem("gaelgraph.authenticated", "true");
      const daily = { date: new Date().toISOString().slice(0, 10), score: profile.today_score };
      if (profile.today_score !== null) localStorage.setItem("gaelgraph.daily", JSON.stringify(daily));
      else localStorage.removeItem("gaelgraph.daily");
    } catch (error) {
      if (error.status === 401) {
        localStorage.removeItem("gaelgraph.authenticated");
        localStorage.removeItem("gaelgraph.daily");
        if (protectedPage) {
          const returnTo = `${location.pathname}${location.search}`;
          location.replace(`/?return=${encodeURIComponent(returnTo)}`);
        }
        return;
      }
      throw error;
    }

    renderProfile();
    if (!profile.region_type || !profile.region_name) {
      document.querySelector("#region-modal").hidden = false;
      return;
    }
    document.dispatchEvent(new CustomEvent("profile:ready", { detail: profile }));
  }

  async function configureSignIn() {
    const target = document.querySelector("#google-signin");
    if (!target) return;
    for (let attempt = 0; !window.google?.accounts?.id && attempt < 50; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!window.google?.accounts?.id) {
      showStatus(document.querySelector("[data-login-status]"), "Google sign-in could not be loaded. Refresh to try again.");
      return;
    }
    const config = await api("/config");
    if (!config.googleClientId) {
      showStatus(document.querySelector("[data-login-status]"), "Google sign-in is not configured yet.");
      return;
    }
    google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: async ({ credential }) => {
        try {
          await api("/auth/google", {
            method: "POST",
            body: JSON.stringify({ credential }),
          });
          const returnTo = new URLSearchParams(location.search).get("return");
          const destination = new URL(returnTo || "/", location.origin);
          location.replace(
            destination.origin === location.origin
              ? `${destination.pathname}${destination.search}${destination.hash}`
              : "/",
          );
        } catch (error) {
          showStatus(document.querySelector("[data-login-status]"), error.message);
        }
      },
    });
    google.accounts.id.renderButton(target, {
      theme: "outline", size: "large", shape: "pill", text: "continue_with",
    });
  }

  function wireLogout() {
    document.querySelector("[data-logout]")?.addEventListener("click", async () => {
      await api("/auth/logout", { method: "POST" });
      localStorage.removeItem("gaelgraph.authenticated");
      localStorage.removeItem("gaelgraph.daily");
      location.assign("/");
    });
  }

  function setupSettings() {
    document.querySelector("[data-settings]")?.addEventListener("click", () => {
      if (!profile) return;
      const form = document.querySelector("#region-form");
      form.elements.regionType.value = profile.region_type || "ireland";
      form.elements.regionType.dispatchEvent(new Event("change"));
      if (profile.region_name) form.elements.regionName.value = profile.region_name;
      document.querySelector("#region-modal").hidden = false;
    });
    document.querySelector("[data-close-region]")?.addEventListener("click", () => {
      if (profile?.region_type) document.querySelector("#region-modal").hidden = true;
    });
  }

  function initLeaderboard() {
    const container = document.querySelector("#leaderboard-list");
    if (!container) return;
    let period = "daily";
    let scope = "global";
    const status = document.querySelector("#leaderboard-status");
    async function load() {
      container.innerHTML = '<div class="loading">Loading scores…</div>';
      showStatus(status, "");
      try {
        const data = await api(`/leaderboard?period=${period}&scope=${scope}`);
        container.replaceChildren();
        if (!data.entries.length) {
          container.innerHTML = '<div class="empty-state">No scores yet for this timeframe. Be the first to play.</div>';
          return;
        }
        for (const entry of data.entries) {
          const row = document.createElement("div");
          row.className = "leader-row";
          row.innerHTML = `<div class="rank">${entry.rank}</div>
            <div class="leader-user">
              ${entry.picture_url ? `<img class="avatar" src="${escapeHtml(entry.picture_url)}" alt="">` : '<span class="avatar"></span>'}
              <div><strong>${escapeHtml(entry.display_name)}</strong><span>${escapeHtml(entry.region_name || "Region not set")}</span></div>
            </div><div class="leader-score">${entry.points.toLocaleString()} pts</div>`;
          container.append(row);
        }
      } catch (error) {
        showStatus(status, error.message);
      }
    }
    document.querySelectorAll("[data-period]").forEach((button) => button.addEventListener("click", () => {
      period = button.dataset.period;
      document.querySelectorAll("[data-period]").forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)));
      load();
    }));
    document.querySelectorAll("[data-scope]").forEach((button) => button.addEventListener("click", () => {
      scope = button.dataset.scope;
      document.querySelectorAll("[data-scope]").forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)));
      load();
    }));
    document.addEventListener("profile:ready", load, { once: true });
  }

  function initFriends() {
    const list = document.querySelector("#friends-list");
    if (!list) return;
    const status = document.querySelector("#friends-status");
    async function load() {
      try {
        const data = await api("/friends");
        document.querySelector("[data-user-id]").textContent = data.userId;
        renderFriendSections(data);
      } catch (error) {
        showStatus(status, error.message);
      }
    }
    function renderFriendSections(data) {
      const friends = document.querySelector("#accepted-friends");
      const incoming = document.querySelector("#incoming-requests");
      const outgoing = document.querySelector("#outgoing-requests");
      friends.replaceChildren();
      incoming.replaceChildren();
      outgoing.replaceChildren();
      appendFriendNames(friends, data.friends, "You haven't added any friends yet.");
      if (!data.incoming.length) incoming.innerHTML = '<div class="empty-state">No pending friend requests.</div>';
      for (const request of data.incoming) {
        const item = document.createElement("div");
        item.className = "friend-item";
        item.innerHTML = `<strong>${escapeHtml(request.name)}</strong>
          <span class="friend-actions">
            <button class="button" data-action="accept">Accept</button>
            <button class="button danger" data-action="decline">Decline</button>
          </span>`;
        item.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            await api(`/friends/${encodeURIComponent(request.request_id)}`, {
              method: "POST", body: JSON.stringify({ action: button.dataset.action }),
            });
            await load();
          } catch (error) {
            showStatus(status, error.message);
            button.disabled = false;
          }
        }));
        incoming.append(item);
      }
      appendFriendNames(outgoing, data.outgoing, "No outgoing requests.");
    }
    document.querySelector("#friend-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("[type=submit]");
      button.disabled = true;
      showStatus(status, "");
      try {
        await api("/friends/request", {
          method: "POST", body: JSON.stringify({ userId: form.elements.userId.value }),
        });
        form.reset();
        await load();
      } catch (error) {
        showStatus(status, error.message);
      } finally {
        button.disabled = false;
      }
    });
    document.addEventListener("profile:ready", load, { once: true });
  }

  function appendFriendNames(container, people, emptyMessage) {
    if (!people.length) {
      container.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
      return;
    }
    for (const person of people) {
      const row = document.createElement("div");
      row.className = "friend-item";
      row.innerHTML = `<strong>${escapeHtml(person.name)}</strong>`;
      container.append(row);
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[character]));
  }

  async function initHome() {
    const startButton = document.querySelector("#start-game");
    if (!startButton) return;
    document.addEventListener("profile:ready", (event) => {
      const todayScore = event.detail.today_score;
      if (todayScore !== null) {
        startButton.textContent = `Today's score · ${todayScore} pts`;
        startButton.classList.add("completed");
        startButton.setAttribute("aria-disabled", "true");
        startButton.removeAttribute("href");
      }
    }, { once: true });
  }

  setupRegionForm();
  setupSettings();
  wireLogout();
  initLeaderboard();
  initFriends();
  initHome();
  configureSignIn().catch((error) => showStatus(document.querySelector("[data-login-status]"), error.message));
  loadProfile().catch((error) => {
    showStatus(document.querySelector("[data-page-status]"), error.message);
  });
})();
