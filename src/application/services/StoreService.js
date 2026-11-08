import { db } from '../../infrastructure/database/JsonDatabase.js';

export class StoreService {
  constructor() {
    this.db = db;
  }

  getSettings() {
    return this.db.get().settings || {};
  }

  updateSettings(updates) {
    const data = this.db.get();
    data.settings = { ...data.settings, ...updates };
    this.db.save();
    return data.settings;
  }

  isStoreOpen() {
    const settings = this.getSettings();

    // Se o controle for manual, respeita o toggle
    if (!settings.useAutoSchedule) {
      return {
        isOpen: !!settings.isOpenManual,
        mode: 'manual',
        message: settings.isOpenManual ? 'Loja aberta e recebendo pedidos!' : 'Loja fechada no momento.'
      };
    }

    // Se for por horário automático:
    const now = new Date();
    // Ajuste para horário de Brasília (UTC-3)
    const brTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const dayOfWeek = brTime.getDay(); // 0: Dom, 1: Seg, ...
    const hours = String(brTime.getHours()).padStart(2, '0');
    const minutes = String(brTime.getMinutes()).padStart(2, '0');
    const currentTimeStr = `${hours}:${minutes}`;

    const schedule = (settings.schedules || []).find(s => s.day === dayOfWeek);

    if (!schedule || !schedule.active) {
      return {
        isOpen: false,
        mode: 'auto',
        message: `Fechado hoje (${schedule?.dayName || 'hoje'}).`
      };
    }

    const isOpen = currentTimeStr >= schedule.open && currentTimeStr <= schedule.close;
    return {
      isOpen,
      mode: 'auto',
      schedule,
      currentTime: currentTimeStr,
      message: isOpen 
        ? `Loja aberta até às ${schedule.close}!` 
        : `Fechado agora. Horário de funcionamento hoje: das ${schedule.open} às ${schedule.close}.`
    };
  }

  toggleOpenStatus(forceStatus = null) {
    const settings = this.getSettings();
    if (forceStatus !== null) {
      settings.isOpenManual = !!forceStatus;
    } else {
      settings.isOpenManual = !settings.isOpenManual;
    }
    settings.useAutoSchedule = false; // ao alterar manualmente, desativa temporariamente o modo automático
    this.updateSettings(settings);
    return this.isStoreOpen();
  }
}

export const storeService = new StoreService();
