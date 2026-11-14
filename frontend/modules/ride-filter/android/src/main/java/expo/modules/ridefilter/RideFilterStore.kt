package expo.modules.ridefilter

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

object RideFilterStore {
  private const val PREFS = "ride_filter_prefs"
  const val KEY_CONFIG = "config"
  const val KEY_EVENTS = "events"
  private const val KEY_BUSY_99 = "busy_99"
  private const val KEY_BUSY_99_SINCE = "busy_99_since"
  private const val KEY_STATUS_LOG = "status_log"
  private const val MAX_EVENTS = 300

  fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun config(context: Context): JSONObject? {
    val raw = prefs(context).getString(KEY_CONFIG, null) ?: return null
    return try { JSONObject(raw) } catch (e: Exception) { null }
  }

  fun isBusy99(context: Context): Boolean = prefs(context).getBoolean(KEY_BUSY_99, false)

  fun setBusy99(context: Context, busy: Boolean) {
    prefs(context).edit()
      .putBoolean(KEY_BUSY_99, busy)
      .putLong(KEY_BUSY_99_SINCE, System.currentTimeMillis())
      .apply()
  }

  /** JSON: {busy_99, since, log:[{type, at}]} */
  fun syncState(context: Context): String {
    val p = prefs(context)
    val log = try { JSONArray(p.getString(KEY_STATUS_LOG, "[]")) } catch (e: Exception) { JSONArray() }
    return JSONObject().apply {
      put("busy_99", p.getBoolean(KEY_BUSY_99, false))
      put("since", p.getLong(KEY_BUSY_99_SINCE, 0L))
      put("log", log)
    }.toString()
  }

  fun resetBusy99(context: Context) = setBusy99(context, false)

  @Synchronized
  fun appendStatus(context: Context, type: String) {
    val p = prefs(context)
    val current = try { JSONArray(p.getString(KEY_STATUS_LOG, "[]")) } catch (e: Exception) { JSONArray() }
    current.put(JSONObject().apply { put("type", type); put("at", System.currentTimeMillis()) })
    p.edit().putString(KEY_STATUS_LOG, trim(current, 30).toString()).apply()
  }

  @Synchronized
  fun appendEvent(context: Context, event: JSONObject) {
    val p = prefs(context)
    val current = try { JSONArray(p.getString(KEY_EVENTS, "[]")) } catch (e: Exception) { JSONArray() }
    current.put(event)
    p.edit().putString(KEY_EVENTS, trim(current, MAX_EVENTS).toString()).apply()
  }

  private fun trim(arr: JSONArray, max: Int): JSONArray {
    val out = JSONArray()
    val start = maxOf(0, arr.length() - max)
    for (i in start until arr.length()) out.put(arr.get(i))
    return out
  }
}
