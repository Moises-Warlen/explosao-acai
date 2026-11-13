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

    // Se o administrador forçou o fechamento manual da loja pelo painel:
    if (settings.isOpenManual === false) {
      return {
        isOpen: false,
        mode: 'manual',
        message: 'Loja fechada temporariamente pelo administrador.',
        schedules: settings.schedules || []
      };
    }

    // Se não estiver em modo de horário automático e o admin abriu manualmente:
    if (!settings.useAutoSchedule) {
      return {
        isOpen: !!settings.isOpenManual,
        mode: 'manual',
        message: settings.isOpenManual ? 'Loja aberta e recebendo pedidos!' : 'Loja fechada no momento.',
        schedules: settings.schedules || []
      };
    }

    // Horário de funcionamento automático baseado no fuso horário oficial de Brasília (America/Sao_Paulo)
    const now = new Date();
    const brTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const dayOfWeek = brTime.getDay(); // 0: Dom, 1: Seg, 2: Ter, 3: Qua, 4: Qui, 5: Sex, 6: Sáb
    const hours = String(brTime.getHours()).padStart(2, '0');
    const minutes = String(brTime.getMinutes()).padStart(2, '0');
    const currentTimeStr = `${hours}:${minutes}`;

    const schedule = (settings.schedules || []).find(s => s.day === dayOfWeek);

    if (!schedule || !schedule.active) {
      return {
        isOpen: false,
        mode: 'auto',
        schedule,
        currentTime: currentTimeStr,
        schedules: settings.schedules || [],
        message: `Fechado hoje (${schedule?.dayName || 'hoje'}).`
      };
    }

    const isOpen = currentTimeStr >= schedule.open && currentTimeStr <= schedule.close;
    return {
      isOpen,
      mode: 'auto',
      schedule,
      currentTime: currentTimeStr,
      schedules: settings.schedules || [],
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
