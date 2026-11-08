import { db } from '../../infrastructure/database/JsonDatabase.js';

// Coordenadas da Loja (Rua Renato Lourenço Fernandes Rosa, 1721, Aeroporto 3, Franca - SP)
const STORE_COORDS = {
  lat: -20.5904206,
  lon: -47.3689222
};

// Tabela de distâncias médias por bairro em Franca/SP a partir do Jardim Aeroporto 3
const FRANCA_BAIRROS_KM = [
  // Raio de até 2 km (Frete Grátis)
  { names: ['aeroporto', 'jd aeroporto', 'jardim aeroporto', 'aeroporto 1', 'aeroporto 2', 'aeroporto 3', 'aeroporto 4'], km: 1.2 },
  { names: ['santa cruz', 'jd santa cruz', 'jardim santa cruz'], km: 1.5 },
  { names: ['aviacao', 'jd aviacao', 'jardim aviacao'], km: 1.6 },
  { names: ['esmeralda', 'pq esmeralda', 'parque das esmeraldas'], km: 1.7 },
  { names: ['elimar', 'recanto elimar', 'jd elimar', 'jardim elimar'], km: 1.9 },
  { names: ['parque do horto', 'pq do horto', 'horto'], km: 2.2 },

  // De 2.5 km a 5.0 km
  { names: ['sao sebastiao', 'vila sao sebastiao', 'v sao sebastiao'], km: 3.5 },
  { names: ['progresso', 'parque progresso', 'pq progresso'], km: 3.8 },
  { names: ['paulistano', 'jd paulistano', 'jardim paulistano'], km: 4.0 },
  { names: ['noemia', 'jd noemia', 'jardim noemia'], km: 4.3 },
  { names: ['formosa', 'vila formosa', 'v formosa'], km: 4.5 },
  { names: ['franca polo', 'polo club'], km: 4.6 },
  { names: ['hipica', 'vila hipica', 'residencial hipica'], km: 4.8 },

  // De 5.0 km a 8.0 km
  { names: ['estacao', 'bairro estacao'], km: 6.2 },
  { names: ['vila nova', 'v nova'], km: 6.5 },
  { names: ['centro', 'bairro centro'], km: 7.0 },
  { names: ['cidade nova', 'bairro cidade nova'], km: 7.4 },
  { names: ['sao jose', 'jd sao jose', 'jardim sao jose'], km: 7.6 },
  { names: ['chico julio', 'vila chico julio'], km: 7.9 },

  // Acima de 8.0 km
  { names: ['brasilandia', 'jd brasilandia', 'jardim brasilandia'], km: 8.5 },
  { names: ['redentor', 'jd redentor', 'jardim redentor'], km: 8.8 },
  { names: ['guanabara', 'jd guanabara', 'jardim guanabara'], km: 8.2 },
  { names: ['leporace', 'parque vicente leporace', 'pq leporace'], km: 12.5 },
  { names: ['miramontes', 'jd miramontes', 'jardim miramontes'], km: 13.5 },
  { names: ['vera cruz', 'jd vera cruz', 'jardim vera cruz'], km: 14.0 },
  { names: ['santa terezinha', 'jd santa terezinha'], km: 10.5 },
  { names: ['city posto', 'city posto de franca'], km: 11.0 }
];

export class FreightService {
  constructor() {
    this.db = db;
  }

  /**
   * Calcula distância (em KM) e frete comercial a partir dos dados do endereço do cliente
   */
  async calculateFreightForAddress({ street = '', number = '', bairro = '', cep = '', city = 'Franca', state = 'SP' }) {
    const settings = this.db.get().settings || {};
    const freeKmThreshold = settings.freeKmThreshold !== undefined ? Number(settings.freeKmThreshold) : 2.0;
    const minFreight = settings.minFreight !== undefined ? Number(settings.minFreight) : 4.5;
    const perKmRate = settings.perKmRate !== undefined ? Number(settings.perKmRate) : 1.0;

    let km = await this.resolveDistanceKm({ street, number, bairro, cep, city, state });

    // Regra Comercial do Frete:
    // Até freeKmThreshold (2 km) -> GRÁTIS (R$ 0,00)
    // Acima de 2 km -> Math.max(minFreight, Math.ceil(km * perKmRate * 2) / 2)
    let freight = 0;
    if (km > freeKmThreshold) {
      freight = Math.max(minFreight, Math.ceil(km * perKmRate * 2) / 2);
    } else {
      freight = 0;
    }

    return {
      km: Number(km.toFixed(1)),
      freight: Number(freight.toFixed(2)),
      freeKmThreshold,
      isFree: freight === 0,
      minFreight,
      perKmRate
    };
  }

  /**
   * Tenta rota real via Nominatim + OSRM com timeout rápido; se indisponível, usa tabela de Franca
   */
  async resolveDistanceKm({ street = '', number = '', bairro = '', cep = '', city = 'Franca', state = 'SP' }) {
    const normStreet = (street || '').trim().toLowerCase();
    const normBairro = (bairro || '').trim().toLowerCase();
    const normCep = String(cep || '').replace(/\D/g, '');

    // 1. Tenta roteamento real por geocodificação OSM com timeout seguro de 1.5s
    if (normStreet && normStreet.length > 3) {
      try {
        const osmDist = await this.tryOsmRouteDistance({ street, city, state });
        if (osmDist && osmDist > 0) {
          return osmDist;
        }
      } catch (e) {
        // Fallback silencioso
      }
    }

    // 2. Busca na tabela de bairros de Franca
    if (normBairro) {
      const match = FRANCA_BAIRROS_KM.find(entry =>
        entry.names.some(n => normBairro.includes(n) || n.includes(normBairro))
      );
      if (match) {
        return match.km;
      }
    }

    // 3. Busca se o nome da rua contém indicação de bairro ou aeroporto
    const streetMatch = FRANCA_BAIRROS_KM.find(entry =>
      entry.names.some(n => normStreet.includes(n))
    );
    if (streetMatch) {
      return streetMatch.km;
    }

    // 4. Estimativa por faixa de CEP em Franca (14400 a 14409)
    if (normCep.length >= 5) {
      const prefix = normCep.substring(0, 5);
      if (prefix === '14404') return 1.4; // Região Aeroporto (Grátis)
      if (prefix === '14403') return 3.2;
      if (prefix === '14402') return 3.8;
      if (prefix === '14405') return 6.8;
      if (prefix === '14400' || prefix === '14401') return 7.2;
      if (prefix === '14407') return 8.5;
      if (prefix === '14408' || prefix === '14409') return 12.0;
    }

    // Padrão razoável se rua e bairro não forem encontrados (bairro intermediário em Franca)
    return 3.5;
  }

  /**
   * Consulta OSRM com Nominatim com AbortSignal de timeout
   */
  async tryOsmRouteDistance({ street, city = 'Franca', state = 'SP' }) {
    const cleanStreet = street.replace(/[0-9]/g, '').trim();
    if (!cleanStreet || cleanStreet.length < 3) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);

    try {
      const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&street=${encodeURIComponent(cleanStreet)}&city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&country=Brasil`;
      const res = await fetch(nomUrl, {
        headers: { 'User-Agent': 'ExplosaoAcaiDelivery/1.0' },
        signal: controller.signal
      });
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return null;

      const { lat, lon } = data[0];
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${STORE_COORDS.lon},${STORE_COORDS.lat};${lon},${lat}?overview=false`;
      const routeRes = await fetch(osrmUrl, { signal: controller.signal });
      const routeData = await routeRes.json();

      if (routeData?.routes?.[0]?.distance) {
        const distKm = routeData.routes[0].distance / 1000;
        return Math.round(distKm * 10) / 10;
      }
    } catch (err) {
      return null;
    } finally {
      clearTimeout(timeout);
    }
    return null;
  }
}

export const freightService = new FreightService();
