import { db } from '../../infrastructure/database/JsonDatabase.js';

// CEP e Coordenadas da Loja (Rua Renato Lourenço Fernandes Rosa, 1721, Aeroporto 3, Franca - SP)
export const STORE_CEP = '14404-250';
export const STORE_COORDS = {
  lat: -20.5904206,
  lon: -47.3689222
};

// Distâncias reais calibradas de trajeto a partir do CEP 14404-250 (Jd. Aeroporto 3)
const FRANCA_BAIRROS_KM = [
  // Raio de até 2 km da loja (Frete Grátis)
  { names: ['aeroporto', 'jd aeroporto', 'jardim aeroporto', 'aeroporto 1', 'aeroporto 2', 'aeroporto 3', 'aeroporto 4', 'mundo novo', 'pq mundo novo', 'universitario', 'pq universitario', 'piemonte'], km: 1.5 },

  // De 2.5 km a 5.0 km
  { names: ['santa cruz', 'jd santa cruz', 'jardim santa cruz', 'vila santa cruz'], km: 3.5 },
  { names: ['elimar', 'recanto elimar', 'jd elimar', 'jardim elimar', 'santa lucia'], km: 4.5 },
  { names: ['progresso', 'parque progresso', 'pq progresso', 'castelo'], km: 5.0 },
  { names: ['sao sebastiao', 'vila sao sebastiao', 'v sao sebastiao'], km: 5.2 },

  // De 5.5 km a 8.0 km
  { names: ['paulistano', 'jd paulistano', 'jardim paulistano', 'paulista', 'jd paulista'], km: 6.0 },
  { names: ['noemia', 'jd noemia', 'jardim noemia'], km: 6.5 },
  { names: ['formosa', 'vila formosa', 'v formosa', 'santa efigenia'], km: 6.8 },
  { names: ['hipica', 'vila hipica', 'residencial hipica', 'franca polo'], km: 7.2 },

  // De 8.0 km a 11.0 km
  { names: ['estacao', 'bairro estacao'], km: 8.0 },
  { names: ['centro', 'bairro centro'], km: 8.5 },
  { names: ['vila nova', 'v nova'], km: 8.8 },
  { names: ['cidade nova', 'bairro cidade nova', 'consolacao'], km: 9.8 },
  { names: ['sao jose', 'jd sao jose', 'jardim sao jose'], km: 10.0 },
  { names: ['chico julio', 'vila chico julio'], km: 10.2 },
  { names: ['brasilandia', 'jd brasilandia', 'jardim brasilandia'], km: 10.8 },
  { names: ['redentor', 'jd redentor', 'guanabara', 'jd guanabara'], km: 11.2 },

  // Acima de 12.0 km (Extremo Norte / Oeste de Franca)
  { names: ['santa terezinha', 'jd santa terezinha'], km: 12.5 },
  { names: ['leporace', 'parque vicente leporace', 'pq leporace', 'leporace 1', 'leporace 2'], km: 14.2 },
  { names: ['miramontes', 'jd miramontes', 'jardim miramontes'], km: 15.0 },
  { names: ['vera cruz', 'jd vera cruz', 'jardim vera cruz'], km: 15.5 },
  { names: ['city posto', 'city petropolis', 'petropolis'], km: 16.0 }
];

export class FreightService {
  constructor() {
    this.db = db;
    this.cache = new Map();
  }

  /**
   * Calcula distância real (em KM) e frete comercial a partir do CEP da loja (14404-250) até o CEP/endereço de destino
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
      perKmRate,
      originCep: STORE_CEP
    };
  }

  /**
   * Resolve a distância real de trajeto de rua entre o CEP 14404-250 e o CEP/endereço informado
   */
  async resolveDistanceKm({ street = '', number = '', bairro = '', cep = '', city = 'Franca', state = 'SP' }) {
    const normStreet = (street || '').trim().toLowerCase();
    const normBairro = (bairro || '').trim().toLowerCase();
    const normCep = String(cep || '').replace(/\D/g, '');

    // 1. Mesmo CEP da loja (14404-250): distância mínima imediata (Grátis)
    if (normCep === '14404250' || (normStreet.includes('renato lourenco') || normStreet.includes('renato lourenço'))) {
      return 0.5;
    }

    // Cache em memória para evitar chamadas de rede repetidas
    const cacheKey = `${normCep}_${normStreet}_${normBairro}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // 2. Tenta roteamento real de trajeto por geocodificação da rua em Franca
    if (normStreet && normStreet.length > 3) {
      try {
        const osmDist = await this.tryOsmRouteDistance({ street, city, state });
        if (osmDist && osmDist > 0) {
          this.cache.set(cacheKey, osmDist);
          return osmDist;
        }
      } catch (e) {
        // Fallback silencioso
      }
    }

    // 3. Estimativa precisa pela faixa oficial de CEP em Franca a partir do CEP 14404-250
    if (normCep.length >= 5) {
      const prefix = normCep.substring(0, 5);
      let cepDist = null;

      if (prefix === '14404') cepDist = 1.5;   // Aeroporto 1, 2, 3, 4, Univ, Mundo Novo (Grátis)
      else if (prefix === '14403') cepDist = 4.5; // Elimar, Progresso, Primavera, Santa Lúcia
      else if (prefix === '14402') cepDist = 6.0; // Paulistano, Paulista
      else if (prefix === '14401') cepDist = 6.8; // Formosa, Noemia, Santa Efigenia
      else if (prefix === '14400') cepDist = 8.5; // Centro, Estação, Vila Nova
      else if (prefix === '14405') cepDist = 9.8; // Cidade Nova, Consolação
      else if (prefix === '14406') cepDist = 10.8; // Brasilândia, Redentor, Guanabara
      else if (prefix === '14407') cepDist = 14.2; // Leporace 1, 2
      else if (prefix === '14408' || prefix === '14409') cepDist = 15.5; // Vera Cruz, Miramontes, Petrópolis

      if (cepDist !== null) {
        this.cache.set(cacheKey, cepDist);
        return cepDist;
      }
    }

    // 4. Busca pelo bairro correspondente em Franca
    if (normBairro) {
      const match = FRANCA_BAIRROS_KM.find(entry =>
        entry.names.some(n => normBairro.includes(n) || n.includes(normBairro))
      );
      if (match) {
        this.cache.set(cacheKey, match.km);
        return match.km;
      }
    }

    // 5. Busca se o nome da rua contém indicação de bairro
    const streetMatch = FRANCA_BAIRROS_KM.find(entry =>
      entry.names.some(n => normStreet.includes(n))
    );
    if (streetMatch) {
      this.cache.set(cacheKey, streetMatch.km);
      return streetMatch.km;
    }

    // Padrão razoável intermediário em Franca
    return 4.5;
  }

  /**
   * Consulta rota real via Photon (Komoot OSM) + OSRM driving route com timeout rápido
   */
  async tryOsmRouteDistance({ street, city = 'Franca', state = 'SP' }) {
    const cleanStreet = street.replace(/[0-9]/g, '').replace(/,/g, '').trim();
    if (!cleanStreet || cleanStreet.length < 3) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1600);

    try {
      const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(cleanStreet + ' Franca SP')}&limit=1`;
      const res = await fetch(photonUrl, { signal: controller.signal });
      const data = await res.json();
      const feat = data.features?.[0];

      if (feat && feat.geometry?.coordinates) {
        const [lon, lat] = feat.geometry.coordinates;
        // Valida se as coordenadas pertencem à grande Franca/SP
        if (lat >= -20.70 && lat <= -20.40 && lon >= -47.50 && lon <= -47.25) {
          const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${STORE_COORDS.lon},${STORE_COORDS.lat};${lon},${lat}?overview=false`;
          const routeRes = await fetch(osrmUrl, { signal: controller.signal });
          const routeData = await routeRes.json();
          if (routeData?.routes?.[0]?.distance) {
            const distKm = routeData.routes[0].distance / 1000;
            return Math.round(distKm * 10) / 10;
          }
        }
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
