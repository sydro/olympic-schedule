import Gio from 'gi://Gio'
import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import Soup from 'gi://Soup'
import Pango from 'gi://Pango'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'

export default class OlympicRingsExtension extends Extension {
  // enable(): create the topbar button, menu, and wire all signal handlers.
  enable() {
    this._panelActor = Main.panel.actor ?? Main.panel
    this._settings = this.getSettings()
    this._panelActor = Main.panel.actor ?? Main.panel
    this._logger = this.getLogger ? this.getLogger() : null
    this._keyPressId = 0
    this._prevKeyFocus = null

    this._button = new St.Button({
      style_class: 'panel-button olympic-rings-button',
      reactive: true,
      can_focus: true,
      track_hover: true,
    })
    this._button.set_style('padding: 0 6px;')

    this._icon = new St.Icon()
    this._icon.set_style('height: 20px; width: 35px;')
    this._icon.set_translation(0, 0, 0)
    this._button.set_child(this._icon)

    this._menuManager = new PopupMenu.PopupMenuManager(this)
    this._menu = new PopupMenu.PopupMenu(this._button, 0.0, St.Side.TOP)
    this._menu.actor.hide()
    Main.uiGroup.add_child(this._menu.actor)
    this._menuManager.addMenu(this._menu)

    this._settingsItem = new PopupMenu.PopupMenuItem('Settings')
    this._settingsItem.connect('activate', () => {
      this.openPreferences()
    })
    this._menu.addMenuItem(this._settingsItem)

    this._buttonPressId = this._button.connect('button-press-event', (actor, event) => {
      const button = event.get_button()
      if (button === Clutter.BUTTON_SECONDARY) {
        this._menu.toggle()
        return Clutter.EVENT_STOP
      }
      if (button === Clutter.BUTTON_PRIMARY) {
        this._menu.close()
        this._togglePopup()
        return Clutter.EVENT_STOP
      }
      if (button === Clutter.BUTTON_MIDDLE) {
        return Clutter.EVENT_STOP
      }
      return Clutter.EVENT_PROPAGATE
    })
    this._buttonReleaseId = this._button.connect('button-release-event', (actor, event) => {
      const button = event.get_button()
      if (
        button === Clutter.BUTTON_PRIMARY ||
        button === Clutter.BUTTON_SECONDARY ||
        button === Clutter.BUTTON_MIDDLE
      ) {
        return Clutter.EVENT_STOP
      }
      return Clutter.EVENT_PROPAGATE
    })

    Main.panel._rightBox.insert_child_at_index(this._button, 0)

    this._updateIcon()
    this._themeChangedId = this._panelActor.connect('style-changed', () => {
      this._updateIcon()
    })
  }

  // disable(): disconnect signals and destroy all UI elements created by the extension.
  disable() {
    this._hidePopup()

    this._settings = null
    this._logger = null

    if (this._buttonPressId) {
      this._button.disconnect(this._buttonPressId)
      this._buttonPressId = null
    }
    if (this._buttonReleaseId) {
      this._button.disconnect(this._buttonReleaseId)
      this._buttonReleaseId = null
    }

    if (this._themeChangedId) {
      this._panelActor.disconnect(this._themeChangedId)
      this._themeChangedId = null
    }

    if (this._menu) {
      this._menu.destroy()
      this._menu = null
    }
    this._menuManager = null

    if (this._button) {
      this._button.destroy()
      this._button = null
    }
    this._icon = null
  }

  // _updateIcon(): choose the correct rings variant based on topbar background contrast.
  _updateIcon() {
    const bg = this._panelActor.get_theme_node().get_background_color()
    const luminance = (0.2126 * bg.red + 0.7152 * bg.green + 0.0722 * bg.blue) / 255
    const ringVariant = luminance < 0.5 ? 'olympic-rings-white.svg' : 'olympic-rings.svg'
    const iconPath = `${this.path}/icons/${ringVariant}`
    const gicon = Gio.icon_new_for_string(iconPath)
    this._icon.gicon = gicon
  }

  // _togglePopup(): open/close the main schedule popup.
  _togglePopup() {
    if (this._popup) {
      this._hidePopup()
      return
    }

    this._popup = new St.BoxLayout({
      style:
        'background-color: #ffffff; color: #0f172a; padding: 10px 12px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.22);',
      reactive: true,
      vertical: true,
    })
    const headerBox = new St.BoxLayout({ vertical: true })
    headerBox.set_style('padding-bottom: 6px; margin-bottom: 10px;')
    const headerRow = new St.BoxLayout({ x_expand: true })
    const header = new St.Label({ text: 'Olympic Schedule' })
    header.set_style('font-weight: 900; font-size: 16px;')
    headerRow.add_child(header)
    const headerSeparator = new St.Widget({ style: 'background-color: #cbd5e1; height: 2px; margin-top: 6px;' })
    headerBox.add_child(headerRow)
    headerBox.add_child(headerSeparator)

    this._popupContent = new St.BoxLayout({
      vertical: true,
      style: 'max-width: 520px; padding-right: 10px;',
    })

    const dayRow = new St.BoxLayout({ x_expand: true })
    dayRow.set_style('background: #e6f4ff; border-radius: 8px; padding: 4px 6px; margin: 6px 0;')
    const prevButton = new St.Button({ reactive: true, can_focus: true, track_hover: true })
    prevButton.set_style('padding: 2px 6px; border-radius: 6px; background: #f1f5f9;')
    const prevIcon = new St.Icon({
      icon_name: 'go-previous-symbolic',
      style_class: 'system-status-icon',
      icon_size: 16,
    })
    prevButton.set_child(prevIcon)
    prevButton.connect('button-press-event', () => {
      this._closeDetails()
      this._advanceDay(-1)
      return Clutter.EVENT_STOP
    })

    this._dayLabel = new St.Label({
      text: this._formatDayTitle(this._currentDay || this._getTodayIsoDate()),
      x_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
    })
    this._dayLabel.set_style('font-weight: 700; font-size: 13px; color: #334155;')

    const nextButton = new St.Button({ reactive: true, can_focus: true, track_hover: true })
    nextButton.set_style('padding: 2px 6px; border-radius: 6px; background: #f1f5f9;')
    const nextIcon = new St.Icon({ icon_name: 'go-next-symbolic', style_class: 'system-status-icon', icon_size: 16 })
    nextButton.set_child(nextIcon)
    nextButton.connect('button-press-event', () => {
      this._closeDetails()
      this._advanceDay(1)
      return Clutter.EVENT_STOP
    })

    dayRow.add_child(prevButton)
    dayRow.add_child(this._dayLabel)
    dayRow.add_child(nextButton)

    this._popupLoadingLabel = new St.Label({
      text: 'Caricamento...',
      x_align: Clutter.ActorAlign.START,
    })
    if (this._popupLoadingLabel.clutter_text) {
      this._popupLoadingLabel.clutter_text.line_wrap = true
      this._popupLoadingLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR
    }
    this._popupContent.add_child(this._popupLoadingLabel)

    this._popupScroll = new St.ScrollView({
      style: 'max-height: 520px;',
      overlay_scrollbars: false,
    })
    const vAdjustment = this._popupScroll.vadjustment || this._popupScroll.vscroll?.adjustment
    if (vAdjustment) {
      this._scrollAdjustId = vAdjustment.connect('notify::value', () => {
        this._closeDetails()
      })
    }
    this._popupScroll.set_child(this._popupContent)
    this._popup.add_child(headerBox)
    this._popup.add_child(dayRow)
    this._popup.add_child(this._popupScroll)
    Main.uiGroup.add_child(this._popup)

    this._positionPopup()

    this._currentDay = this._getTodayIsoDate()
    this._loadSchedule()

    this._ensureEscHandler()
    this._prevKeyFocus = global.stage.get_key_focus()
    global.stage.set_key_focus(this._popup)
  }

  // _hidePopup(): teardown the main popup and related state.
  _hidePopup() {
    this._closeDetails()
    if (this._popupTimeoutId) {
      GLib.source_remove(this._popupTimeoutId)
      this._popupTimeoutId = null
    }
    if (this._popup) {
      this._popup.destroy()
      this._popup = null
    }
    if (this._scrollAdjustId && this._popupScroll) {
      const vAdjustment = this._popupScroll.vadjustment || this._popupScroll.vscroll?.adjustment
      if (vAdjustment) {
        vAdjustment.disconnect(this._scrollAdjustId)
      }
      this._scrollAdjustId = 0
    }
    this._popupScroll = null
    this._popupContent = null
    this._popupLoadingLabel = null
    this._dayLabel = null
    this._cardActors = null
    this._dayUnits = null
    this._detailsUnitId = null
    if (this._detailsPopup) {
      this._detailsPopup.destroy()
      this._detailsPopup = null
    }
    this._disconnectEscHandler()
    if (this._prevKeyFocus) {
      global.stage.set_key_focus(this._prevKeyFocus)
      this._prevKeyFocus = null
    }
  }

  // _positionPopup(): clamp the main popup within the current monitor bounds.
  _positionPopup() {
    if (!this._popup || !this._button) return
    const [bx, by] = this._button.get_transformed_position()
    const [bw, bh] = this._button.get_transformed_size()
    const [, , natW, natH] = this._popup.get_preferred_size()
    const popupW = natW
    const popupH = natH

    const monitor = Main.layoutManager.primaryMonitor
    const margin = 8
    let x = Math.round(bx + (bw - popupW) / 2)
    let y = Math.round(by + bh + 6)

    x = Math.max(monitor.x + margin, Math.min(x, monitor.x + monitor.width - popupW - margin))
    if (y + popupH > monitor.y + monitor.height - margin) {
      y = Math.max(monitor.y + margin, Math.round(by - popupH - 6))
    }

    this._popup.set_position(x, y)
  }

  // _loadSchedule(): fetch schedule data for current NOC/day and render it.
  async _loadSchedule() {
    try {
      const noc = (this._settings.get_string('noc') || 'ITA').trim().toUpperCase()
      const day = this._currentDay || this._getTodayIsoDate()
      const url = `https://www.olympics.com/wmr-owg2026/schedules/api/${noc}/schedule/lite/day/${day}`
      if (this._logger) {
        this._logger.log(`refresh ${url}`)
      } else {
        log(`[olympic-schedule] refresh ${url}`)
      }

      const jsonText = await this._fetchJson(url)
      const data = JSON.parse(jsonText)
      if (this._popupContent) {
        this._renderSchedule(data, day, noc)
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
          this._positionPopup()
          this._scrollToNearest()
          return GLib.SOURCE_REMOVE
        })
      }
    } catch (err) {
      if (this._popupLoadingLabel) {
        this._popupLoadingLabel.text = `Errore: ${err.message ?? err}`
      }
    }
  }

  // _getTodayIsoDate(): return local date in YYYY-MM-DD format.
  _getTodayIsoDate() {
    const now = GLib.DateTime.new_now_local()
    return now.format('%Y-%m-%d')
  }

  // _renderSchedule(): build the list of event cards for the given day.
  _renderSchedule(data, day, noc) {
    this._popupContent.destroy_all_children()
    if (this._dayLabel) {
      this._dayLabel.text = this._formatDayTitle(day)
    }

    const units = Array.isArray(data?.units) ? data.units : []
    const dayUnits = units.filter(u => {
      const d = this._dateFromStart(u.startDate)
      if (d) return d === day
      return (u.olympicDay || '').startsWith(day)
    })
    dayUnits.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))
    this._dayUnits = dayUnits

    if (dayUnits.length === 0) {
      const empty = new St.Label({ text: 'Nessun evento disponibile.' })
      empty.set_style('color: #64748b; margin-top: 8px;')
      this._popupContent.add_child(empty)
      this._cardActors = []
      const vAdjustment = this._popupScroll.vadjustment || this._popupScroll.vscroll?.adjustment
      if (vAdjustment) {
        vAdjustment.set_value(0)
      }
      return
    }

    this._cardActors = []
    for (const unit of dayUnits) {
      const card = this._buildCard(unit, noc)
      this._cardActors.push(card)
      this._popupContent.add_child(card)
    }
  }

  // _buildCard(): render a single event card with medals or competitors summary.
  _buildCard(unit, noc) {
    const status = (unit.status || '').toUpperCase()
    const isLive = unit.liveFlag || status === 'IN_PROGRESS' || status === 'LIVE' || status === 'ACTIVE'
    const isPast = status === 'FINISHED' || status === 'CANCELLED' || status === 'COMPLETED'
    const bg = isLive ? '#fff5cc' : isPast ? '#e2e8f0' : '#f1f5f9'

    const card = new St.BoxLayout({
      vertical: true,
      style: `background: ${bg}; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px;`,
    })
    card.reactive = true
    card.can_focus = true
    card.track_hover = true
    card.connect('button-press-event', () => {
      this._toggleDetails(unit)
      return Clutter.EVENT_STOP
    })

    const topRow = new St.BoxLayout({ x_expand: true })
    const timeText = this._formatStartTime(unit)
    const timeLabel = new St.Label({ text: timeText })
    timeLabel.set_style('font-weight: 700; margin-right: 10px;')

    const titleBox = new St.BoxLayout({ vertical: true, x_expand: true })
    const discipline = new St.Label({ text: unit.disciplineName || 'Evento' })
    discipline.set_style('font-weight: 700;')
    const subtitle = new St.Label({ text: unit.eventUnitName || unit.eventName || '' })
    subtitle.set_style('color: #475569; font-size: 12px;')

    titleBox.add_child(discipline)
    if (subtitle.text) titleBox.add_child(subtitle)

    topRow.add_child(timeLabel)
    topRow.add_child(titleBox)
    card.add_child(topRow)

    const competitors = Array.isArray(unit.competitors) ? unit.competitors : []
    const winners = isPast ? this._getMedalWinners(competitors) : []
    if (winners.length > 0) {
      const medalBox = new St.BoxLayout({ vertical: true, style: 'margin-top: 6px;' })
      for (const winner of winners) {
        const row = new St.BoxLayout({ x_expand: true })
        row.set_style('spacing: 6px;')
        const dot = new St.Label({ text: '●' })
        dot.set_style(`color: ${winner.color}; font-size: 12px;`)
        const mark = winner.mark ? `  ${winner.mark}` : ''
        const label = new St.Label({
          text: `${winner.noc || ''}  ${winner.name || ''}${mark}`,
        })
        const winnerStyle =
          winner.noc === noc
            ? 'font-size: 12px; font-weight: 700; color: #15803d;'
            : 'font-size: 12px; font-weight: 700;'
        label.set_style(winnerStyle)
        row.add_child(dot)
        row.add_child(label)
        medalBox.add_child(row)
      }
      card.add_child(medalBox)
    } else if (competitors.length > 0) {
      const compBox = new St.BoxLayout({ vertical: true, style: 'margin-top: 6px;' })
      const max = Math.min(2, competitors.length)
      for (let i = 0; i < max; i++) {
        const c = competitors[i]
        const mark = c.results?.mark ? `  ${c.results.mark}` : ''
        const line = new St.Label({
          text: `${c.noc || ''}  ${c.name || ''}${mark}`,
        })
        line.set_style(`font-size: 12px; ${c.noc === noc ? 'font-weight: 700; color: #15803d;' : ''}`)
        compBox.add_child(line)
      }
      card.add_child(compBox)
    }

    return card
  }

  // _formatStartTime(): format event start time or fallback label.
  _formatStartTime(unit) {
    if (unit.hideStartDate && unit.startText) {
      return unit.startText
    }
    if (!unit.startDate) {
      return ''
    }
    const dt = GLib.DateTime.new_from_iso8601(unit.startDate, null)
    if (!dt) return ''
    return dt.format('%H:%M')
  }

  // _formatDayTitle(): format a human-readable day title.
  _formatDayTitle(isoDate) {
    const dt = GLib.DateTime.new_from_iso8601(`${isoDate}T00:00:00`, null)
    if (!dt) return isoDate
    const title = dt.format('%e %b, %A')
    return title.charAt(0).toUpperCase() + title.slice(1)
  }

  // _getMedalWinners(): extract medal winners using medalType (gold/silver/bronze).
  _getMedalWinners(competitors) {
    const medalColors = {
      ME_GOLD: '#d4af37',
      ME_SILVER: '#c0c0c0',
      ME_BRONZE: '#cd7f32',
    }
    const order = { ME_GOLD: 1, ME_SILVER: 2, ME_BRONZE: 3 }

    const winners = competitors
      .filter(c => c?.results?.medalType && medalColors[c.results.medalType])
      .map(c => ({
        medalType: c.results.medalType,
        color: medalColors[c.results.medalType],
        noc: c.noc,
        name: c.name,
        mark: c.results?.mark,
        order: order[c.results.medalType] ?? 99,
      }))
      .sort((a, b) => a.order - b.order)

    // Se ci sono duplicati per medalType, prendi il primo
    const seen = new Set()
    const unique = []
    for (const w of winners) {
      if (seen.has(w.medalType)) continue
      seen.add(w.medalType)
      unique.push(w)
    }

    return unique
  }

  // _dateFromStart(): extract YYYY-MM-DD from an ISO datetime.
  _dateFromStart(startDate) {
    if (!startDate) return ''
    const dt = GLib.DateTime.new_from_iso8601(startDate, null)
    if (!dt) return ''
    return dt.format('%Y-%m-%d')
  }

  // _scrollToNearest(): scroll list to the event closest to the current time.
  _scrollToNearest() {
    if (!this._popupScroll || !this._dayUnits || !this._cardActors || this._dayUnits.length === 0) return
    const now = GLib.DateTime.new_now_local()
    let targetIndex = 0
    let minDiff = Number.POSITIVE_INFINITY

    for (let i = 0; i < this._dayUnits.length; i++) {
      const unit = this._dayUnits[i]
      if (!unit.startDate) continue
      const dt = GLib.DateTime.new_from_iso8601(unit.startDate, null)
      if (!dt) continue
      const diff = Math.abs(dt.to_unix() - now.to_unix())
      if (diff < minDiff) {
        minDiff = diff
        targetIndex = i
      }
    }

    const card = this._cardActors[targetIndex]
    if (!card || !card.get_parent()) return
    const box = card.get_allocation_box()
    const adjustment = this._popupScroll.vadjustment || this._popupScroll.vscroll?.adjustment
    if (!adjustment) return
    let offset = Math.max(0, Math.round(box.y1 - 8))
    const max = Math.max(0, adjustment.upper - adjustment.page_size)
    if (offset > max) offset = max
    adjustment.set_value(offset)
  }

  // _closeDetails(): close the details popup if open.
  _closeDetails() {
    if (this._detailsPopup) {
      this._detailsPopup.destroy()
      this._detailsPopup = null
    }
    this._detailsUnitId = null
  }

  // _toggleDetails(): open/close the event details popup for a card.
  _toggleDetails(unit) {
    const noc = (this._settings.get_string('noc') || 'ITA').trim().toUpperCase()
    if (this._detailsUnitId === unit.id && this._detailsPopup) {
      this._closeDetails()
      return
    }
    this._detailsUnitId = unit.id
    if (this._detailsPopup) {
      this._closeDetails()
    }
    this._detailsPopup = this._buildDetailsPopup(unit, noc)
    Main.uiGroup.add_child(this._detailsPopup)
    this._positionDetailsPopup()
  }

  // _buildDetailsPopup(): build the left-side details popup for an event.
  _buildDetailsPopup(unit, noc) {
    const box = new St.BoxLayout({
      vertical: true,
      reactive: true,
      style:
        'background-color: #ffffff; color: #0f172a; padding: 12px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.22);',
    })

    const title = new St.Label({ text: unit.disciplineName || 'Evento' })
    title.set_style('font-weight: 800; font-size: 14px; margin-bottom: 4px;')
    const subtitle = new St.Label({ text: unit.eventUnitName || unit.eventName || '' })
    subtitle.set_style('color: #475569; font-size: 12px; margin-bottom: 8px;')
    box.add_child(title)
    if (subtitle.text) box.add_child(subtitle)

    const infoBox = new St.BoxLayout({
      vertical: true,
      style: 'background: #f1f5f9; border-radius: 8px; padding: 8px; margin-top: 6px;',
    })
    const infoLines = [
      ['Orario', this._formatStartTime(unit)],
      ['Status', unit.statusDescription || unit.status || ''],
      ['Venue', unit.venueDescription || unit.venueLongDescription || ''],
      ['Location', unit.locationShortDescription || unit.locationDescription || ''],
    ]
    for (const [label, value] of infoLines) {
      if (!value) continue
      const line = new St.Label({ text: `${label}: ${value}` })
      line.set_style('font-size: 11px; color: #334155;')
      infoBox.add_child(line)
    }
    box.add_child(infoBox)

    const competitors = Array.isArray(unit.competitors) ? unit.competitors : []
    const winners = this._getMedalWinners(competitors)
    if (winners.length > 0) {
      const medalTitle = new St.Label({ text: 'Medaglie' })
      medalTitle.set_style('font-weight: 700; margin-top: 8px; margin-bottom: 4px;')
      box.add_child(medalTitle)

      const medalBox = new St.BoxLayout({
        vertical: true,
        style: 'background: #f1f5f9; border-radius: 8px; padding: 8px;',
      })
      for (const winner of winners) {
        const row = new St.BoxLayout({ x_expand: true })
        row.set_style('spacing: 6px;')
        const dot = new St.Label({ text: '●' })
        dot.set_style(`color: ${winner.color}; font-size: 12px;`)
        const mark = winner.mark ? `  ${winner.mark}` : ''
        const label = new St.Label({ text: `${winner.noc || ''}  ${winner.name || ''}${mark}` })
        const winnerStyle =
          winner.noc === noc
            ? 'font-size: 12px; font-weight: 700; color: #15803d;'
            : 'font-size: 12px; font-weight: 700;'
        label.set_style(winnerStyle)
        row.add_child(dot)
        row.add_child(label)
        medalBox.add_child(row)
      }
      box.add_child(medalBox)
    }

    const compTitle = new St.Label({ text: 'Competitors' })
    compTitle.set_style('font-weight: 700; margin-top: 8px; margin-bottom: 4px;')
    box.add_child(compTitle)

    const compList = new St.BoxLayout({ vertical: true })
    for (const c of competitors) {
      const mark = c.results?.mark ? `  ${c.results.mark}` : ''
      const line = new St.Label({ text: `${c.noc || ''}  ${c.name || ''}${mark}` })
      const lineStyle = c.noc === noc ? 'font-size: 11px; color: #15803d; font-weight: 700;' : 'font-size: 11px;'
      line.set_style(lineStyle)
      compList.add_child(line)
    }

    const compScroll = new St.ScrollView({ style: 'max-height: 240px;', overlay_scrollbars: false })
    compScroll.set_child(compList)
    const compBox = new St.BoxLayout({
      vertical: true,
      style: 'background: #f1f5f9; border-radius: 8px; padding: 8px;',
    })
    compBox.add_child(compScroll)
    box.add_child(compBox)

    return box
  }

  // _positionDetailsPopup(): position the details popup near the main popup.
  _positionDetailsPopup() {
    if (!this._detailsPopup || !this._popup) return
    const [px, py] = this._popup.get_transformed_position()
    const [, , pW, pH] = this._popup.get_preferred_size()
    const [, , dW, dH] = this._detailsPopup.get_preferred_size()
    const monitor = Main.layoutManager.primaryMonitor
    const margin = 8

    let x = Math.round(px - dW - 8)
    let y = Math.round(py)

    if (x < monitor.x + margin) {
      x = Math.round(px + pW + 8)
    }
    x = Math.max(monitor.x + margin, Math.min(x, monitor.x + monitor.width - dW - margin))
    if (y + dH > monitor.y + monitor.height - margin) {
      y = Math.max(monitor.y + margin, monitor.y + monitor.height - dH - margin)
    }

    this._detailsPopup.set_position(x, y)
  }

  // _advanceDay(): move current day forward/backward and refresh data.
  _advanceDay(deltaDays) {
    const base = this._currentDay || this._getTodayIsoDate()
    const dt = GLib.DateTime.new_from_iso8601(`${base}T00:00:00Z`, null)
    if (!dt) return
    const next = dt.add_days(deltaDays).format('%Y-%m-%d')
    this._currentDay = next
    if (this._dayLabel) {
      this._dayLabel.text = this._formatDayTitle(next)
    }
    if (this._popupContent) {
      this._popupContent.destroy_all_children()
      this._popupContent.add_child(new St.Label({ text: 'Caricamento...' }))
    }
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      this._loadSchedule()
      return GLib.SOURCE_REMOVE
    })
  }

  // _fetchJson(): HTTP GET and return response text for a URL.
  _fetchJson(url) {
    const session = new Soup.Session()
    const message = Soup.Message.new('GET', url)
    message.request_headers.append(
      'User-Agent',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
    )
    message.request_headers.append('Accept', 'application/json')

    return new Promise((resolve, reject) => {
      session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
        try {
          const bytes = sess.send_and_read_finish(res)
          const data = bytes.get_data()
          const text = new TextDecoder('utf-8').decode(data)
          if (message.get_status() !== Soup.Status.OK) {
            reject(new Error(`HTTP ${message.get_status()}`))
            return
          }
          resolve(text)
        } catch (e) {
          reject(e)
        }
      })
    })
  }

  // _ensureEscHandler(): close popups when ESC is pressed.
  _ensureEscHandler() {
    if (this._keyPressId) return
    this._keyPressId = global.stage.connect('key-press-event', (actor, event) => {
      if (!this._popup) return Clutter.EVENT_PROPAGATE
      if (event.get_key_symbol() === Clutter.KEY_Escape) {
        this._hidePopup()
        return Clutter.EVENT_STOP
      }
      return Clutter.EVENT_PROPAGATE
    })
  }

  // _disconnectEscHandler(): remove ESC handler when popups are closed.
  _disconnectEscHandler() {
    if (this._keyPressId) {
      global.stage.disconnect(this._keyPressId)
      this._keyPressId = 0
    }
  }
}
