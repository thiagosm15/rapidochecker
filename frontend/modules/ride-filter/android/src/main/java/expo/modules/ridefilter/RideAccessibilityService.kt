package expo.modules.ridefilter

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * 1) Reads RapidoCar ride offers and taps "Aceitar" when they pass the user's filters.
 * 2) 99 sync: when a ride is in progress on the 99 app, opens RapidoCar and goes offline;
 *    when the 99 ride ends, opens RapidoCar and goes back online. Then returns to the 99 app.
 */
class RideAccessibilityService : AccessibilityService() {
  private var lastSignature = ""
  private var lastTime = 0L

  private var pendingAction: String? = null // "go_offline" | "go_online"
  private var pendingSince = 0L
  private var returnPackage: String? = null
  private val handler = Handler(Looper.getMainLooper())

  private val priceRe = Regex("""R\$\s*(\d{1,3}(?:\.\d{3})*,\d{1,2}|\d+(?:[.,]\d{1,2})?)""")
  private val kmRe = Regex("""(\d+(?:[.,]\d+)?)\s*km\b""", RegexOption.IGNORE_CASE)

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null) return
    val pkg = event.packageName?.toString() ?: return
    val pkgLower = pkg.lowercase()
    if (pkg == packageName) return
    val cfg = RideFilterStore.config(this) ?: return

    // ---- 99 app: detect ride start / end ----
    if (cfg.optBoolean("sync_99_enabled", false)) {
      val p99 = cfg.optString("ninety_nine_package", "app99").trim().lowercase()
      if (p99.isNotEmpty() && pkgLower.contains(p99)) {
        handle99(pkg, cfg)
        return
      }
    }

    val target = cfg.optString("target_package", "rapido").trim().lowercase()
    if (target.isEmpty() || !pkgLower.contains(target)) return
    val root = rootInActiveWindow ?: return

    // ---- RapidoCar: finish a pending offline/online switch ----
    if (pendingAction != null) {
      handlePending(root, cfg)
      return
    }

    if (!cfg.optBoolean("auto_accept", false)) return
    if (RideFilterStore.isBusy99(this)) return // never accept while driving a 99 ride

    acceptIfMatches(root, cfg, pkg)
  }

  override fun onInterrupt() {}

  // ---------------- 99 sync ----------------

  private fun handle99(pkg99: String, cfg: JSONObject) {
    if (pendingAction != null) return
    val root = rootInActiveWindow ?: return
    val texts = mutableListOf<String>()
    collectTexts(root, texts, 0)
    val busy = RideFilterStore.isBusy99(this)
    val endTexts = readList(cfg.optJSONArray("ride_end_texts"), listOf("Corrida finalizada", "Avaliar passageiro"))
    val activeTexts = readList(cfg.optJSONArray("ride_active_texts"), listOf("Iniciar corrida", "Finalizar corrida"))

    if (busy && containsAny(texts, endTexts)) {
      RideFilterStore.setBusy99(this, false)
      RideFilterStore.appendStatus(this, "99_ride_ended")
      startPending("go_online", pkg99, cfg)
    } else if (!busy && containsAny(texts, activeTexts)) {
      RideFilterStore.setBusy99(this, true)
      RideFilterStore.appendStatus(this, "99_ride_started")
      startPending("go_offline", pkg99, cfg)
    }
  }

  private fun startPending(action: String, pkg99: String, cfg: JSONObject) {
    val target = cfg.optString("target_package", "rapido").trim().lowercase()
    val rapidoPkg = findLaunchablePackage(target) ?: run {
      RideFilterStore.appendStatus(this, "rapido_not_found")
      return
    }
    pendingAction = action
    pendingSince = System.currentTimeMillis()
    returnPackage = pkg99
    launch(rapidoPkg)
    val token = pendingSince
    handler.postDelayed({
      if (pendingAction != null && pendingSince == token) {
        RideFilterStore.appendStatus(this, "${action}_timeout")
        pendingAction = null
        returnTo99()
      }
    }, 12000)
  }

  private fun handlePending(root: AccessibilityNodeInfo, cfg: JSONObject) {
    val action = pendingAction ?: return
    val labels = if (action == "go_offline") {
      readList(cfg.optJSONArray("offline_texts"), listOf("Ficar offline", "Desconectar"))
    } else {
      readList(cfg.optJSONArray("online_texts"), listOf("Ficar online", "Conectar"))
    }
    val node = findLabeledNode(root, labels) ?: return
    clickNode(node)
    pendingAction = null
    RideFilterStore.appendStatus(this, if (action == "go_offline") "rapido_offline" else "rapido_online")
    handler.postDelayed({ returnTo99() }, 900)
  }

  private fun returnTo99() {
    returnPackage?.let { launch(it) }
    returnPackage = null
  }

  private fun launch(pkg: String) {
    val intent = packageManager.getLaunchIntentForPackage(pkg) ?: return
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    try { startActivity(intent) } catch (e: Exception) { /* ignored */ }
  }

  private fun findLaunchablePackage(sub: String): String? {
    if (sub.isEmpty()) return null
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    return packageManager.queryIntentActivities(intent, 0)
      .map { it.activityInfo.packageName }
      .firstOrNull { it.lowercase().contains(sub) && it != packageName }
  }

  // ---------------- RapidoCar auto-accept ----------------

  private fun acceptIfMatches(root: AccessibilityNodeInfo, cfg: JSONObject, pkg: String) {
    val texts = mutableListOf<String>()
    collectTexts(root, texts, 0)
    val all = texts.joinToString(" | ")

    val acceptTexts = readList(cfg.optJSONArray("accept_texts"), listOf("Aceitar", "Accept"))
    val button = findLabeledNode(root, acceptTexts) ?: return

    val price = priceRe.find(all)?.groupValues?.get(1)?.let { parseNumber(it) } ?: return
    val kms = kmRe.findAll(all).mapNotNull { parseNumber(it.groupValues[1]) }.toList()
    if (kms.isEmpty()) return
    val pickupKm = if (kms.size >= 2) kms[0] else 0.0
    val tripKm = if (kms.size >= 2) kms[1] else kms[0]
    if (tripKm <= 0.0) return

    val signature = "$price|$tripKm|$pickupKm"
    val now = System.currentTimeMillis()
    if (signature == lastSignature && now - lastTime < 20000) return
    lastSignature = signature
    lastTime = now

    val ppk = Math.round(price / tripKm * 100.0) / 100.0
    val reasons = JSONArray()
    if (ppk < cfg.optDouble("min_price_per_km", 0.0)) reasons.put("R$/km abaixo do mínimo")
    if (price < cfg.optDouble("min_fare", 0.0)) reasons.put("Valor abaixo do mínimo")
    if (pickupKm > cfg.optDouble("max_pickup_km", Double.MAX_VALUE)) reasons.put("Busca muito longe")

    val accepted = reasons.length() == 0
    if (accepted) clickNode(button)

    RideFilterStore.appendEvent(this, JSONObject().apply {
      put("price", price)
      put("trip_km", tripKm)
      put("pickup_km", pickupKm)
      put("price_per_km", ppk)
      put("accepted", accepted)
      put("reasons", reasons)
      put("source", "rapidocar")
      put("created_at", isoNow())
    })
  }

  // ---------------- helpers ----------------

  private fun isoNow(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
    timeZone = TimeZone.getTimeZone("UTC")
  }.format(Date())

  private fun readList(arr: JSONArray?, fallback: List<String>): List<String> {
    if (arr == null || arr.length() == 0) return fallback
    return (0 until arr.length()).map { arr.optString(it).trim() }.filter { it.isNotEmpty() }
  }

  private fun containsAny(texts: List<String>, markers: List<String>): Boolean =
    texts.any { t -> markers.any { m -> t.contains(m, ignoreCase = true) } }

  private fun parseNumber(raw: String): Double? {
    val s = raw.trim()
    val normalized = if (s.contains(",")) s.replace(".", "").replace(",", ".") else s
    return normalized.toDoubleOrNull()
  }

  private fun collectTexts(node: AccessibilityNodeInfo?, out: MutableList<String>, depth: Int) {
    if (node == null || depth > 40) return
    node.text?.toString()?.takeIf { it.isNotBlank() }?.let { out.add(it) }
    node.contentDescription?.toString()?.takeIf { it.isNotBlank() }?.let { out.add(it) }
    for (i in 0 until node.childCount) collectTexts(node.getChild(i), out, depth + 1)
  }

  private fun findLabeledNode(node: AccessibilityNodeInfo?, labels: List<String>): AccessibilityNodeInfo? {
    if (node == null) return null
    val text = (node.text ?: node.contentDescription)?.toString()?.trim()
    if (text != null && labels.any { text.equals(it, ignoreCase = true) || text.startsWith(it, ignoreCase = true) }) {
      return node
    }
    for (i in 0 until node.childCount) {
      val found = findLabeledNode(node.getChild(i), labels)
      if (found != null) return found
    }
    return null
  }

  private fun clickNode(node: AccessibilityNodeInfo) {
    var current: AccessibilityNodeInfo? = node
    while (current != null && !current.isClickable) current = current.parent
    (current ?: node).performAction(AccessibilityNodeInfo.ACTION_CLICK)
  }
}
