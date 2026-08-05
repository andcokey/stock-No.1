// ブラウザ側の暗号化・復号（my_dashboard の sync/crypto.js / web/assets/app.js と同一フォーマット）。
// { __enc:1, alg:"A256GCM", kdf:"PBKDF2-SHA256", iter, salt, iv, ct } (salt/iv/ct はbase64)

const ITER = 150000;

function b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function unb64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

async function deriveKey(password, salt, usages) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  );
}

export async function encryptJson(obj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { __enc: 1, alg: "A256GCM", kdf: "PBKDF2-SHA256", iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

export async function decryptJson(payload, password) {
  const key = await deriveKey(password, unb64(payload.salt), ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(payload.iv) }, key, unb64(payload.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

export function isEncrypted(obj) {
  return !!(obj && obj.__enc === 1 && obj.ct);
}

export function getPass() {
  return localStorage.getItem("stock_pass") || "";
}
export function setPass(p) {
  localStorage.setItem("stock_pass", p);
}

/** 合言葉入力オーバーレイ（#unlock-overlay / #unlock-input / #unlock-btn / #unlock-error が必要） */
export function askPassphrase(wrongPrevious) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("unlock-overlay");
    overlay.classList.add("open");
    const input = document.getElementById("unlock-input");
    const btn = document.getElementById("unlock-btn");
    const err = document.getElementById("unlock-error");
    err.textContent = wrongPrevious ? "合言葉が違います。もう一度入力してください。" : "";
    input.value = "";
    input.focus();
    const submit = () => {
      if (!input.value) return;
      overlay.classList.remove("open");
      btn.removeEventListener("click", submit);
      input.removeEventListener("keydown", onKey);
      resolve(input.value);
    };
    const onKey = (e) => { if (e.key === "Enter") submit(); };
    btn.addEventListener("click", submit);
    input.addEventListener("keydown", onKey);
  });
}

/** 暗号化されたJSONを、合言葉入力を挟みつつ復号する。復号成功時は合言葉をlocalStorageに保存。 */
export async function resolveEncrypted(payload) {
  if (!isEncrypted(payload)) return payload;
  let pass = getPass();
  let wrong = false;
  while (true) {
    if (pass) {
      try {
        const data = await decryptJson(payload, pass);
        setPass(pass);
        return data;
      } catch {
        wrong = true;
        pass = "";
      }
    }
    pass = await askPassphrase(wrong);
  }
}
