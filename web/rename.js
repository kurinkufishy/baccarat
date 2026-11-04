// "Change my name" box inside the account window, shared by both pages. Costs chips; the server checks everything.
export const RENAME_COST = 1000000;

export function setupRename({ call, errMsg, flash, fmt, getMe, getPlayers, myFree }) {
  const $ = (id) => document.getElementById(id);
  const box = document.createElement("div");
  box.className = "rnbox";
  box.innerHTML = `<label class="flab" for="rnin">名前を変える（${fmt(RENAME_COST)} チップ）</label>
    <div class="rnrow"><input id="rnin" maxlength="12" autocomplete="off" placeholder="新しい名前"><button class="go" id="rngo">変更</button></div>
    <p class="small" id="rnnote"></p>`;
  const modal = $("acctm").querySelector(".modal");
  modal.insertBefore(box, $("leavebtn") || $("signout"));
  let busy = false;

  function draw() {
    const p = getPlayers()[getMe()], v = $("rnin").value.trim();
    const enough = myFree() >= RENAME_COST;
    $("rngo").disabled = busy || !p || !v || v === p.name || !enough;
    $("rngo").textContent = busy ? "変更中…" : "変更";
    $("rnnote").textContent = !p ? "" : !enough ? `チップが足りないよ（残高 ${fmt(myFree())}）` : `今の名前: ${p.name}　変更すると残高から ${fmt(RENAME_COST)} 引かれるよ`;
  }
  async function go() {
    const name = $("rnin").value.trim();
    if (!name || busy) return;
    busy = true; draw();
    try { await call("rename", { name }); flash(`名前を「${name}」に変えたよ（-${fmt(RENAME_COST)}）`); $("acctm").hidden = true; $("rnin").value = ""; }
    catch (e) { busy = false; draw(); $("rnnote").textContent = errMsg(e); return; }
    busy = false; draw();
  }
  $("rnin").addEventListener("input", draw);
  $("rnin").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); go(); } });
  $("rngo").addEventListener("click", go);
  return { reset() { $("rnin").value = ""; busy = false; draw(); } };
}
