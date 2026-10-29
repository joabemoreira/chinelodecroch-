/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    fbq?: any;
    _fbq?: any;
    __indoParaCheckout?: boolean;
  }
}

/**
 * Legitimate campaign acquisition identifiers aligned with Nexo's acquisitionNames logic.
 * The presence of ANY of these parameters in the incoming URL signals a genuine new campaign entry.
 */
const CAMPAIGN_IDENTIFIERS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'src',
  'fbclid',
  'gclid',
] as const;

/**
 * Secondary technical tracking parameters (e.g. sck).
 * These parameters do NOT define a new campaign and MUST NOT erase stored campaign attribution.
 */
const TECHNICAL_TRACKING_PARAMS = ['sck'] as const;

const ALL_ATTRIBUTION_PARAMS = [
  ...CAMPAIGN_IDENTIFIERS,
  ...TECHNICAL_TRACKING_PARAMS,
] as const;

const SESSION_STORAGE_KEY = 'croche_campaign_attribution';

/**
 * Captures active campaign attribution:
 * 1. Checks if current URL contains a legitimate new campaign identifier (utm_*, src, fbclid, gclid).
 * 2. If a new campaign is identified:
 *    - Captures non-empty parameters from the URL.
 *    - Replaces previous session attribution completely (prevents mixing old UTMs with a new campaign).
 * 3. If NO new campaign identifier is present in current URL:
 *    - Restores the active campaign attribution from sessionStorage (protects UTMs from being wiped by /oferta, modal, refreshes or ?sck=interno).
 *    - If current URL carries a technical parameter like ?sck=interno, attaches it alongside active UTMs without clearing the stored campaign.
 * 4. Never fabricates missing parameters.
 */
function getActiveAttributionParams(): Record<string, string> {
  if (typeof window === 'undefined') return {};

  try {
    const searchParams = new URLSearchParams(window.location.search);

    // 1. Check if there is a legitimate new campaign acquisition entry
    const hasLegitimateCampaign = CAMPAIGN_IDENTIFIERS.some((key) => {
      const val = searchParams.get(key);
      return val !== null && val.trim() !== '';
    });

    if (hasLegitimateCampaign) {
      const newCampaignParams: Record<string, string> = {};
      ALL_ATTRIBUTION_PARAMS.forEach((key) => {
        const val = searchParams.get(key);
        if (val !== null && val.trim() !== '') {
          newCampaignParams[key] = val.trim();
        }
      });

      try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newCampaignParams));
      } catch {
        // ignore storage quota/security issues
      }
      return newCampaignParams;
    }

    // 2. If no new campaign, restore active campaign from session
    let activeParams: Record<string, string> = {};
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          activeParams = { ...parsed };
        }
      } catch {
        // ignore
      }
    }

    // 3. If current URL contains an isolated technical parameter (e.g. ?sck=interno),
    // retain it alongside the stored campaign without wiping the session!
    const currentSck = searchParams.get('sck');
    if (currentSck && currentSck.trim() !== '') {
      return { ...activeParams, sck: currentSck.trim() };
    }

    return activeParams;
  } catch {
    // ignore
  }

  return {};
}

/**
 * Merges active attribution parameters into checkout base URL
 * without duplicating parameters, preserving checkout's own parameters and hashes.
 */
function buildCheckoutUrl(baseUrl: string, params: Record<string, string>): string {
  try {
    const url = new URL(baseUrl);
    Object.entries(params).forEach(([key, val]) => {
      if (!url.searchParams.has(key) && val) {
        url.searchParams.set(key, val);
      }
    });
    return url.toString();
  } catch {
    return baseUrl;
  }
}

export default function App() {
  // Video state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [hasStartedWithSound, setHasStartedWithSound] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoEnded, setVideoEnded] = useState(false);

  // Zoom Lightbox state
  const [zoomImg, setZoomImg] = useState<{ src: string; alt: string } | null>(null);

  // Upsell Modal state
  const [showUpsell, setShowUpsell] = useState(false);

  // Timer state (10 minutes = 600s)
  const [secondsLeft, setSecondsLeft] = useState(600);

  // Checkout URLs with UTM preservation
  const [checkoutLinks, setCheckoutLinks] = useState({
    completo: 'https://pay.wiapy.com/-lj7Rw0Hvb6c',
    upsellComBonus: 'https://pay.wiapy.com/hdMoHHmCsDBJ',
    basico: 'https://pay.wiapy.com/6bTerw0Gok0e',
  });

  // Track if ViewContent has already fired
  const hasFiredViewContent = useRef(false);

  // Auto-scroll refs for horizontal rails
  const modelosRef = useRef<HTMLDivElement>(null);
  const galeriaRef = useRef<HTMLDivElement>(null);
  const provasRef = useRef<HTMLDivElement>(null);
  const depoRef = useRef<HTMLDivElement>(null);

  // Initialize checkout URLs with active attribution parameters
  useEffect(() => {
    const activeParams = getActiveAttributionParams();
    setCheckoutLinks({
      completo: buildCheckoutUrl('https://pay.wiapy.com/-lj7Rw0Hvb6c', activeParams),
      upsellComBonus: buildCheckoutUrl('https://pay.wiapy.com/hdMoHHmCsDBJ', activeParams),
      basico: buildCheckoutUrl('https://pay.wiapy.com/6bTerw0Gok0e', activeParams),
    });
  }, []);

  // Back-Redirect configuration & /oferta detection & bfcache return handling
  useEffect(() => {
    window.__indoParaCheckout = false;

    // Reset flag if page is restored from bfcache or tab switch
    const handlePageShow = () => {
      window.__indoParaCheckout = false;
    };
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('focus', handlePageShow);

    // If page is loaded directly at /oferta or #oferta, smooth scroll to the pricing cards
    if (window.location.pathname.startsWith('/oferta') || window.location.hash === '#oferta') {
      setTimeout(() => {
        const el = document.getElementById('marcador-planos') || document.getElementById('oferta');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);
    }

    // Push state to history to enable intercepting browser back button
    try {
      window.history.pushState({ page: 'vsl' }, '', window.location.href);
    } catch {
      // Ignore if pushState not permitted in certain sandboxes
    }

    const handlePopState = () => {
      // If user clicked any checkout button, do not intercept
      if (window.__indoParaCheckout) {
        return;
      }

      // If user is not yet on /oferta, redirect to /oferta preserving UTM parameters
      if (!window.location.pathname.startsWith('/oferta')) {
        const search = window.location.search || '';
        window.location.href = `/oferta${search}`;
      } else {
        // If already on /oferta, scroll to pricing section without creating infinite reload loop
        const el = document.getElementById('marcador-planos') || document.getElementById('oferta');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('focus', handlePageShow);
    };
  }, []);

  // ViewContent tracking: fires strictly once when the beginning of the pricing cards enters viewport
  useEffect(() => {
    const marker = document.getElementById('marcador-planos') || document.querySelector('.planos');
    if (!marker || hasFiredViewContent.current) return;

    let retryTimer: ReturnType<typeof setInterval> | null = null;
    let retries = 0;
    const MAX_RETRIES = 10;

    const dispatchViewContent = (): boolean => {
      if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
        window.fbq('track', 'ViewContent', {
          content_name: '40 Modelos de Chinelos de Crochê',
          content_type: 'product',
          value: 25.9,
          currency: 'BRL',
        });
        hasFiredViewContent.current = true;
        return true;
      }
      return false;
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !hasFiredViewContent.current) {
            // Disconnect immediately to prevent re-triggering
            observer.disconnect();

            const sent = dispatchViewContent();
            if (!sent) {
              // Limited retry handling if fbq not yet initialized
              retryTimer = setInterval(() => {
                retries += 1;
                if (dispatchViewContent() || retries >= MAX_RETRIES) {
                  if (retryTimer) clearInterval(retryTimer);
                  retryTimer = null;
                }
              }, 200);
            }
          }
        });
      },
      {
        threshold: 0,
        rootMargin: '0px 0px -20px 0px',
      }
    );

    observer.observe(marker);
    return () => {
      observer.disconnect();
      if (retryTimer) clearInterval(retryTimer);
    };
  }, []);

  // Smooth scroll to offer section
  const scrollToOferta = (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    const ofertaEl = document.getElementById('oferta');
    if (ofertaEl) {
      ofertaEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Timer countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTimer = (secs: number) => {
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  // Video autoplay when visible
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!hasStartedWithSound) {
            if (entry.isIntersecting) {
              vid.play().catch(() => {});
              setIsPlaying(true);
            } else {
              vid.pause();
              setIsPlaying(false);
            }
          }
        });
      },
      { threshold: 0.3 }
    );

    observer.observe(vid);
    return () => observer.disconnect();
  }, [hasStartedWithSound]);

  const handleStartSound = (e: React.MouseEvent) => {
    e.stopPropagation();
    const vid = videoRef.current;
    if (!vid) return;
    setHasStartedWithSound(true);
    setVideoEnded(false);
    vid.loop = false;
    vid.muted = false;
    vid.currentTime = 0;
    vid.play().then(() => {
      setIsPlaying(true);
      setIsMuted(false);
    }).catch(() => {});
  };

  const handleVideoClick = () => {
    const vid = videoRef.current;
    if (!vid || !hasStartedWithSound || videoEnded) return;

    if (vid.paused) {
      vid.play();
      setIsPlaying(true);
    } else {
      vid.pause();
      setIsPlaying(false);
    }
  };

  const handleRestartVideo = (e: React.MouseEvent) => {
    e.stopPropagation();
    const vid = videoRef.current;
    if (!vid) return;
    setVideoEnded(false);
    vid.currentTime = 0;
    vid.play();
    setIsPlaying(true);
  };

  const handleTimeUpdate = () => {
    const vid = videoRef.current;
    if (vid && vid.duration) {
      setVideoProgress((vid.currentTime / vid.duration) * 100);
    }
  };

  const handleVideoEnded = () => {
    if (hasStartedWithSound) {
      setVideoEnded(true);
      setIsPlaying(false);
    }
  };

  // Keyboard Escape for modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setZoomImg(null);
        setShowUpsell(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Prevent background scroll when modal open
  useEffect(() => {
    if (zoomImg || showUpsell) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  }, [zoomImg, showUpsell]);

  // Infinite continuous auto-scrolling for rails
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const setupInfiniteScroll = (el: HTMLDivElement | null) => {
      if (!el) return () => {};
      let isPaused = false;
      let pos = el.scrollLeft;
      let accum = 0;
      let half = el.scrollWidth / 2;

      const onResize = () => {
        half = el.scrollWidth / 2;
      };
      window.addEventListener('resize', onResize);

      const pause = () => { isPaused = true; };
      const resume = () => { isPaused = false; };

      el.addEventListener('pointerdown', pause);
      el.addEventListener('touchstart', pause);
      el.addEventListener('pointerup', resume);
      el.addEventListener('touchend', resume);
      el.addEventListener('pointercancel', resume);
      el.addEventListener('mouseleave', resume);

      let animId: number;
      const step = () => {
        if (!isPaused && half > 0) {
          accum += 0.45;
          if (accum >= 1) {
            const stepPx = Math.floor(accum);
            accum -= stepPx;
            pos += stepPx;
            if (pos >= half) {
              pos -= half;
            }
            el.scrollLeft = pos;
          }
        } else {
          pos = el.scrollLeft;
        }
        animId = requestAnimationFrame(step);
      };

      animId = requestAnimationFrame(step);

      return () => {
        cancelAnimationFrame(animId);
        window.removeEventListener('resize', onResize);
        el.removeEventListener('pointerdown', pause);
        el.removeEventListener('touchstart', pause);
        el.removeEventListener('pointerup', resume);
        el.removeEventListener('touchend', resume);
        el.removeEventListener('pointercancel', resume);
        el.removeEventListener('mouseleave', resume);
      };
    };

    const cleanup1 = setupInfiniteScroll(modelosRef.current);
    const cleanup2 = setupInfiniteScroll(galeriaRef.current);
    const cleanup3 = setupInfiniteScroll(provasRef.current);
    const cleanup4 = setupInfiniteScroll(depoRef.current);

    return () => {
      cleanup1();
      cleanup2();
      cleanup3();
      cleanup4();
    };
  }, []);

  return (
    <>
      {/* Launch Offer Banner */}
      <div className="barra">
        <div className="l1">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          Oferta de lançamento
        </div>
        <div className="l2">De R$ 99,90 por R$ 25,90 só hoje</div>
      </div>

      {/* Hero Section */}
      <header className="hero">
        <div className="wrap hero-grid">
          <div className="hero-topo">
            <h1>
              Mais de 40 modelos de chinelos de crochê{' '}
              <span className="script" style={{ display: 'inline', whiteSpace: 'normal' }}>
                para fazer em casa
              </span>
              , com receitas e videoaulas passo a passo
            </h1>
            <p className="sub">
              Aprenda de forma simples, no seu ritmo, para usar, presentear ou vender por encomenda.
            </p>
          </div>
          <div className="hero-img">
            <img
              src="/images/foto-700.webp"
              srcSet="/images/foto-420.webp 420w, /images/foto-700.webp 700w, /images/foto-1100.webp 1100w, /images/foto-1400.webp 1400w"
              sizes="(max-width:820px) 88vw, 46vw"
              alt="Pés calçando chinelos de crochê com laço azul, cercados de pares com limão, rosas vermelhas, arco-íris, flor laranja e babado"
              width="1400"
              height="1045"
              style={{ aspectRatio: '1400/1045', objectFit: 'cover' }}
            />
          </div>
          <div className="hero-btn centro">
            <button className="btn ir-oferta" onClick={scrollToOferta}>
              QUERO OS 40 MODELOS
            </button>
          </div>
        </div>
        <div className="wrap">
          <div className="stats">
            <div className="stat">
              <b>40</b>
              <span>modelos de chinelos</span>
            </div>
            <div className="stat">
              <b>5</b>
              <span>bônus inclusos</span>
            </div>
            <div className="stat">
              <b>PDF</b>
              <span>no celular ou impresso</span>
            </div>
            <div className="stat">
              <b>∞</b>
              <span>acesso vitalício</span>
            </div>
          </div>
        </div>
      </header>

      <main>
        {/* Video Section ("Veja por dentro") */}
        <section className="vid-sec">
          <div className="wrap centro">
            <span className="pill">Veja por dentro</span>
            <h2 style={{ margin: '16px 0 12px' }}>
              Olha exatamente <span className="script">o que você recebe</span>
            </h2>
            <p className="sub">
              Do e-mail de acesso até as receitas abertas no celular: o PDF pra imprimir, os bônus,
              as videoaulas e tudo o que vem no app.
            </p>
            <div className="vplayer" id="vp" onClick={handleVideoClick}>
              <video
                ref={videoRef}
                id="vv"
                muted={isMuted}
                playsInline
                loop={!hasStartedWithSound}
                preload="metadata"
                width="720"
                height="1280"
                poster="/images/capa.webp"
                src="/media/apresentacao.mp4"
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleVideoEnded}
              />

              {!hasStartedWithSound && (
                <button
                  className="v-som"
                  type="button"
                  aria-label="Ativar o som"
                  onClick={handleStartSound}
                >
                  <span className="v-som-card">
                    <small>Seu vídeo já começou</small>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M11 5 6 9H2v6h4l5 4V5z" />
                      <path d="m23 9-6 6" />
                      <path d="m17 9 6 6" />
                    </svg>
                    <b>Toque para ouvir</b>
                  </span>
                </button>
              )}

              {hasStartedWithSound && !isPlaying && !videoEnded && (
                <div className="v-pausa">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              )}

              {videoEnded && (
                <div className="v-fim">
                  <b>Gostou do que viu?</b>
                  <button type="button" className="btn ir-oferta" onClick={scrollToOferta}>
                    QUERO OS 40 MODELOS →
                  </button>
                  <button type="button" className="de-novo" onClick={handleRestartVideo}>
                    ↻ Assistir de novo
                  </button>
                </div>
              )}

              <div className="v-barra">
                <i style={{ width: `${videoProgress}%` }} />
              </div>
            </div>
          </div>
        </section>

        {/* Models Carousel */}
        <section className="amostras">
          <div className="wrap centro">
            <span className="pill">Alguns dos modelos</span>
            <h2 style={{ margin: '16px 0 12px' }}>
              Qual vai ser <span className="script">o seu primeiro par?</span>
            </h2>
            <p className="sub">
              São 40 modelos, de flor a frutinha, pra usar, presentear ou vender. Arraste pro lado e
              veja como cada receita chega pra você.
            </p>
          </div>
          <div className="wrap">
            <div className="trilho modelos" id="modelos" ref={modelosRef}>
              <figure>
                <img
                  src="/images/modelo-01.webp"
                  srcSet="/images/modelo-01_3.webp 360w, /images/modelo-01_2.webp 460w, /images/modelo-01.webp 600w"
                  sizes="(max-width:600px) 230px, 300px"
                  alt="Página do modelo 01, Lírio Laranja com tira rosa bebê, com foto, gráfico e receita da aplicação"
                  width="600"
                  height="900"
                  loading="lazy"
                />
              </figure>
              <figure>
                <img
                  src="/images/modelo-12.webp"
                  srcSet="/images/modelo-12_2.webp 360w, /images/modelo-12_3.webp 460w, /images/modelo-12.webp 600w"
                  sizes="(max-width:600px) 230px, 300px"
                  alt="Página do modelo 12, Girassol com tira listrada, com foto, gráfico e receita da aplicação"
                  width="600"
                  height="900"
                  loading="lazy"
                />
              </figure>
              <figure>
                <img
                  src="/images/modelo-23.webp"
                  srcSet="/images/modelo-23_2.webp 360w, /images/modelo-23_3.webp 460w, /images/modelo-23.webp 600w"
                  sizes="(max-width:600px) 230px, 300px"
                  alt="Página do modelo 23, Arco-íris entre nuvens, com foto, gráfico e receita da aplicação"
                  width="600"
                  height="900"
                  loading="lazy"
                />
              </figure>
              <figure>
                <img
                  src="/images/modelo-15.webp"
                  srcSet="/images/modelo-15_2.webp 360w, /images/modelo-15_3.webp 460w, /images/modelo-15.webp 600w"
                  sizes="(max-width:600px) 230px, 300px"
                  alt="Página do modelo 15, Moranguinho com tira vermelhinha, com foto, gráfico e receita da aplicação"
                  width="600"
                  height="900"
                  loading="lazy"
                />
              </figure>
              <figure>
                <img
                  src="/images/modelo-32.webp"
                  srcSet="/images/modelo-32_2.webp 360w, /images/modelo-32_3.webp 460w, /images/modelo-32.webp 600w"
                  sizes="(max-width:600px) 230px, 300px"
                  alt="Página do modelo 32, Oncinha em crochê tapeçaria, com foto, gráfico e receita da aplicação"
                  width="600"
                  height="900"
                  loading="lazy"
                />
              </figure>
              <figure>
                <img
                  src="/images/modelo-05.webp"
                  srcSet="/images/modelo-05_2.webp 360w, /images/modelo-05_3.webp 460w, /images/modelo-05.webp 600w"
                  sizes="(max-width:600px) 230px, 300px"
                  alt="Página do modelo 05, Hibisco Rosa com tira verde menta, com foto, gráfico e receita da aplicação"
                  width="600"
                  height="900"
                  loading="lazy"
                />
              </figure>
              <figure>
                <img
                  src="/images/modelo-17.webp"
                  srcSet="/images/modelo-17_2.webp 360w, /images/modelo-17_3.webp 460w, /images/modelo-17.webp 600w"
                  sizes="(max-width:600px) 230px, 300px"
                  alt="Página do modelo 17, Abacaxi no chinelo marinho, com foto, gráfico e receita da aplicação"
                  width="600"
                  height="900"
                  loading="lazy"
                />
              </figure>
              <figure>
                <img
                  src="/images/modelo-24.webp"
                  srcSet="/images/modelo-24_2.webp 360w, /images/modelo-24_3.webp 460w, /images/modelo-24.webp 600w"
                  sizes="(max-width:600px) 230px, 300px"
                  alt="Página do modelo 24, Borboleta Azul asas de leques, com foto, gráfico e receita da aplicação"
                  width="600"
                  height="900"
                  loading="lazy"
                />
              </figure>
              <figure>
                <img
                  src="/images/modelo-30.webp"
                  srcSet="/images/modelo-30_2.webp 360w, /images/modelo-30_3.webp 460w, /images/modelo-30.webp 600w"
                  sizes="(max-width:600px) 230px, 300px"
                  alt="Página do modelo 30, Roda de Rosinhas com broche de pérolas, com foto, gráfico e receita da aplicação"
                  width="600"
                  height="900"
                  loading="lazy"
                />
              </figure>

              {/* Duplicate track for seamless infinite scroll */}
              <figure aria-hidden="true">
                <img
                  src="/images/modelo-01.webp"
                  srcSet="/images/modelo-01_3.webp 360w, /images/modelo-01_2.webp 460w, /images/modelo-01.webp 600w"
                  sizes="(max-width:600px) 230px, 300px"
                  alt=""
                  width="600"
                  height="900"
                  loading="lazy"
                />
              </figure>
              <figure aria-hidden="true">
                <img
                  src="/images/modelo-12.webp"
                  srcSet="/images/modelo-12_2.webp 360w, /images/modelo-12_3.webp 460w, /images/modelo-12.webp 600w"
                  sizes="(max-width:600px) 230px, 300px"
                  alt=""
                  width="600"
                  height="900"
                  loading="lazy"
                />
              </figure>
              <figure aria-hidden="true">
                <img
                  src="/images/modelo-23.webp"
                  srcSet="/images/modelo-23_2.webp 360w, /images/modelo-23_3.webp 460w, /images/modelo-23.webp 600w"
                  sizes="(max-width:600px) 230px, 300px"
                  alt=""
                  width="600"
                  height="900"
                  loading="lazy"
                />
              </figure>
              <figure aria-hidden="true">
                <img
                  src="/images/modelo-15.webp"
                  srcSet="/images/modelo-15_2.webp 360w, /images/modelo-15_3.webp 460w, /images/modelo-15.webp 600w"
                  sizes="(max-width:600px) 230px, 300px"
                  alt=""
                  width="600"
                  height="900"
                  loading="lazy"
                />
              </figure>
              <figure aria-hidden="true">
                <img
                  src="/images/modelo-32.webp"
                  srcSet="/images/modelo-32_2.webp 360w, /images/modelo-32_3.webp 460w, /images/modelo-32.webp 600w"
                  sizes="(max-width:600px) 230px, 300px"
                  alt=""
                  width="600"
                  height="900"
                  loading="lazy"
                />
              </figure>
              <figure aria-hidden="true">
                <img
                  src="/images/modelo-05.webp"
                  srcSet="/images/modelo-05_2.webp 360w, /images/modelo-05_3.webp 460w, /images/modelo-05.webp 600w"
                  sizes="(max-width:600px) 230px, 300px"
                  alt=""
                  width="600"
                  height="900"
                  loading="lazy"
                />
              </figure>
              <figure aria-hidden="true">
                <img
                  src="/images/modelo-17.webp"
                  srcSet="/images/modelo-17_2.webp 360w, /images/modelo-17_3.webp 460w, /images/modelo-17.webp 600w"
                  sizes="(max-width:600px) 230px, 300px"
                  alt=""
                  width="600"
                  height="900"
                  loading="lazy"
                />
              </figure>
              <figure aria-hidden="true">
                <img
                  src="/images/modelo-24.webp"
                  srcSet="/images/modelo-24_2.webp 360w, /images/modelo-24_3.webp 460w, /images/modelo-24.webp 600w"
                  sizes="(max-width:600px) 230px, 300px"
                  alt=""
                  width="600"
                  height="900"
                  loading="lazy"
                />
              </figure>
              <figure aria-hidden="true">
                <img
                  src="/images/modelo-30.webp"
                  srcSet="/images/modelo-30_2.webp 360w, /images/modelo-30_3.webp 460w, /images/modelo-30.webp 600w"
                  sizes="(max-width:600px) 230px, 300px"
                  alt=""
                  width="600"
                  height="900"
                  loading="lazy"
                />
              </figure>
            </div>
            <div className="centro" style={{ marginTop: '40px' }}>
              <button className="btn ir-oferta" onClick={scrollToOferta}>
                VER A OFERTA COMPLETA
              </button>
            </div>
          </div>
        </section>

        {/* 2 Full Pages per Model */}
        <section className="paginas-projeto">
          <div className="wrap centro">
            <span className="pill">O que vem em cada modelo</span>
            <h2 style={{ margin: '16px 0 12px' }}>
              Cada modelo vem em<br />
              <span className="script">2 páginas completas</span>
            </h2>
            <p className="sub">
              Nada de foto solta sem explicação. Da lista de materiais à flor costurada na tira, tudo
              o que você precisa pra fazer aquele par.
            </p>
            <div className="etapas" id="etapas">
              <article className="etapa">
                <div className="etapa-topo">
                  <span className="etapa-num">Página 1</span>
                  <h3>A ficha e a receita</h3>
                </div>
                <button
                  className="etapa-img"
                  type="button"
                  aria-label="Ampliar a página 1: ficha e receita"
                  onClick={() =>
                    setZoomImg({
                      src: '/assets/receita/p1-full.webp',
                      alt: 'Página 1 do modelo Lírio Laranja: foto do chinelo pronto, tempo, tamanhos, materiais, gráfico e receita da aplicação, tabela de tamanhos e dica da professora',
                    })
                  }
                >
                  <img
                    src="/images/p1.webp"
                    srcSet="/images/p1-sm.webp 440w, /images/p1.webp 760w"
                    sizes="(max-width:760px) 75vw, 320px"
                    alt="Página 1 do modelo Lírio Laranja: foto do chinelo pronto, tempo, tamanhos, materiais, gráfico e receita da aplicação, tabela de tamanhos e dica da professora"
                    width="760"
                    height="1140"
                    loading="lazy"
                  />
                  <span className="lupa" aria-hidden="true">
                    ⤢
                  </span>
                </button>
                <div className="etapa-corpo">
                  <p>Você vê o chinelo pronto e já sabe tudo o que comprar antes de pegar a agulha.</p>
                  <ul className="etapa-tags">
                    <li>Nível e tempo</li>
                    <li>Barbante e agulha</li>
                    <li>Gráfico da aplicação</li>
                    <li>Receita por carreira</li>
                    <li>Tabela do 33 ao 42</li>
                  </ul>
                </div>
              </article>

              <article className="etapa">
                <div className="etapa-topo">
                  <span className="etapa-num">Página 2</span>
                  <h3>O passo a passo</h3>
                </div>
                <button
                  className="etapa-img"
                  type="button"
                  aria-label="Ampliar a página 2: passo a passo e montagem"
                  onClick={() =>
                    setZoomImg({
                      src: '/assets/receita/p2-full.webp',
                      alt: 'Página 2 do modelo Lírio Laranja: passo a passo em 8 etapas com foto, do revestimento da tira à flor costurada, resultado final, erros comuns e dicas de ouro',
                    })
                  }
                >
                  <img
                    src="/images/p2.webp"
                    srcSet="/images/p2-sm.webp 440w, /images/p2.webp 760w"
                    sizes="(max-width:760px) 75vw, 320px"
                    alt="Página 2 do modelo Lírio Laranja: passo a passo em 8 etapas com foto, do revestimento da tira à flor costurada, resultado final, erros comuns e dicas de ouro"
                    width="760"
                    height="1140"
                    loading="lazy"
                  />
                  <span className="lupa" aria-hidden="true">
                    ⤢
                  </span>
                </button>
                <div className="etapa-corpo">
                  <p>Oito etapas com foto, do primeiro ponto na tira até a flor presa no chinelo.</p>
                  <ul className="etapa-tags">
                    <li>8 etapas com foto</li>
                    <li>Revestindo a tira</li>
                    <li>Montagem</li>
                    <li>Erros comuns</li>
                    <li>Dicas de ouro</li>
                  </ul>
                </div>
              </article>
            </div>

            <div style={{ marginTop: '44px' }}>
              <button className="btn ir-oferta" onClick={scrollToOferta}>
                QUERO COMEÇAR MEU PRIMEIRO PAR
              </button>
            </div>
          </div>
        </section>

        {/* Benefits Section ("Depois do primeiro par") */}
        <section className="desejo">
          <div className="wrap">
            <div className="centro">
              <span className="pill">Depois do primeiro par</span>
              <h2 style={{ margin: '16px 0 12px' }}>
                Aí vem a pergunta: <span className="script">“onde você comprou?”</span>
              </h2>
              <p className="sub">
                E você responde: <b>fui eu que fiz</b>.
              </p>
            </div>
            <div className="desejo-grid">
              <div className="usos">
                <div className="uso">
                  <span className="u-ico">☀️</span>
                  <b>Para usar</b>
                  <span>
                    Na praia, na piscina ou em casa. Na cor que você quiser, e ninguém vai aparecer
                    com um par igual.
                  </span>
                </div>
                <div className="uso">
                  <span className="u-ico">🎁</span>
                  <b>Para presentear</b>
                  <span>
                    Chinelo feito à mão, no número certo, é presente que a pessoa usa e lembra de quem
                    deu.
                  </span>
                </div>
                <div className="uso">
                  <span className="u-ico">💰</span>
                  <b>Para vender</b>
                  <span>
                    O chinelo liso custa pouco e o crochê é que dá o valor. Dá pra vender por
                    encomenda, no número da cliente.
                  </span>
                </div>
                <div className="uso">
                  <span className="u-ico">✨</span>
                  <b>Para relaxar</b>
                  <span>
                    Uma carreira de cada vez e a cabeça esvazia. A maioria dos modelos fica pronta em
                    uma tarde.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Testimonials ("Quem já fez, aprovou") */}
        <section className="depo" id="depoimentos">
          <div className="wrap centro">
            <span className="pill">Quem já fez, aprovou</span>
            <h2 style={{ margin: '16px 0 12px' }}>
              Elas começaram do zero. <span className="script">Olha o que aconteceu.</span>
            </h2>
            <p className="sub">
              Mensagens de alunas que fizeram os primeiros pares com as receitas e o passo a passo,
              do jeitinho que chegaram no nosso WhatsApp.
            </p>
            <span className="depo-estrelas">
              <b>★★★★★</b> mensagens reais de alunas
            </span>
          </div>
          <div className="wrap">
            <div className="trilho depo-trilho" id="depo" ref={depoRef}>
              <figure className="depo-card">
                <div className="depo-tel">
                  <img
                    src="/images/dep-1.webp"
                    srcSet="/images/dep-1-sm.webp 300w, /images/dep-1.webp 560w"
                    sizes="(max-width:860px) 260px, 250px"
                    alt="Print de conversa no WhatsApp: a aluna Daniela agradece, conta que conseguiu começar do zero e mostra o chinelo com flor verde que fez; o marido nem acreditou"
                    width="560"
                    height="1062"
                    loading="lazy"
                  />
                </div>
              </figure>
              <figure className="depo-card">
                <div className="depo-tel">
                  <img
                    src="/images/dep-2.webp"
                    srcSet="/images/dep-2-sm.webp 300w, /images/dep-2.webp 560w"
                    sizes="(max-width:860px) 260px, 250px"
                    alt="Print de conversa no WhatsApp: a aluna Gaby conta que foi parada no mercado por causa do chinelo e que pagou a compra com as encomendas"
                    width="560"
                    height="1062"
                    loading="lazy"
                  />
                </div>
              </figure>
              <figure className="depo-card">
                <div className="depo-tel">
                  <img
                    src="/images/dep-3.webp"
                    srcSet="/images/dep-3-sm.webp 300w, /images/dep-3.webp 560w"
                    sizes="(max-width:860px) 260px, 250px"
                    alt="Print de conversa no WhatsApp: a aluna Fernanda mostra o primeiro chinelo que fez, com laço amarelo, e diz que ficou melhor do que esperava"
                    width="560"
                    height="1062"
                    loading="lazy"
                  />
                </div>
              </figure>
              <figure className="depo-card">
                <div className="depo-tel">
                  <img
                    src="/images/dep-4.webp"
                    srcSet="/images/dep-4-sm.webp 300w, /images/dep-4.webp 560w"
                    sizes="(max-width:860px) 260px, 250px"
                    alt="Print de conversa no WhatsApp: a aluna Cristiane conta que fez o par em três noites, depois que a bebê dorme, e mostra o chinelo rosa com flores"
                    width="560"
                    height="1062"
                    loading="lazy"
                  />
                </div>
              </figure>

              {/* Duplicates for infinite scroll */}
              <figure className="depo-card" aria-hidden="true">
                <div className="depo-tel">
                  <img
                    src="/images/dep-1.webp"
                    srcSet="/images/dep-1-sm.webp 300w, /images/dep-1.webp 560w"
                    sizes="(max-width:860px) 260px, 250px"
                    alt=""
                    width="560"
                    height="1062"
                    loading="lazy"
                  />
                </div>
              </figure>
              <figure className="depo-card" aria-hidden="true">
                <div className="depo-tel">
                  <img
                    src="/images/dep-2.webp"
                    srcSet="/images/dep-2-sm.webp 300w, /images/dep-2.webp 560w"
                    sizes="(max-width:860px) 260px, 250px"
                    alt=""
                    width="560"
                    height="1062"
                    loading="lazy"
                  />
                </div>
              </figure>
              <figure className="depo-card" aria-hidden="true">
                <div className="depo-tel">
                  <img
                    src="/images/dep-3.webp"
                    srcSet="/images/dep-3-sm.webp 300w, /images/dep-3.webp 560w"
                    sizes="(max-width:860px) 260px, 250px"
                    alt=""
                    width="560"
                    height="1062"
                    loading="lazy"
                  />
                </div>
              </figure>
              <figure className="depo-card" aria-hidden="true">
                <div className="depo-tel">
                  <img
                    src="/images/dep-4.webp"
                    srcSet="/images/dep-4-sm.webp 300w, /images/dep-4.webp 560w"
                    sizes="(max-width:860px) 260px, 250px"
                    alt=""
                    width="560"
                    height="1062"
                    loading="lazy"
                  />
                </div>
              </figure>
            </div>
          </div>
        </section>

        {/* Gallery ("Tudo isso vem na coleção") */}
        <section className="galeria">
          <div className="wrap centro">
            <span className="pill">Tudo isso vem na coleção</span>
            <h2 style={{ margin: '16px 0 12px' }}>
              Flores, frutinhas, <span className="script">laços e charmes</span>
            </h2>
            <p className="sub">
              Tem modelo pra iniciante e pra quem já tem prática. Cada um com a receita completa.
            </p>
          </div>
          <div className="wrap">
            <div className="trilho fotos" id="galeria" ref={galeriaRef}>
              <figure>
                <img
                  src="/images/modelo-01_1.webp"
                  srcSet="/images/modelo-01-sm.webp 320w, /images/modelo-01_1.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt="Chinelo de crochê Lírio Laranja, com tira rosa bebê"
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Lírio Laranja</figcaption>
              </figure>
              <figure>
                <img
                  src="/images/modelo-12_1.webp"
                  srcSet="/images/modelo-12-sm.webp 320w, /images/modelo-12_1.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt="Chinelo de crochê Girassol, com tira listrada"
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Girassol</figcaption>
              </figure>
              <figure>
                <img
                  src="/images/modelo-15_1.webp"
                  srcSet="/images/modelo-15-sm.webp 320w, /images/modelo-15_1.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt="Chinelo de crochê Moranguinho, com tira vermelhinha"
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Moranguinho</figcaption>
              </figure>
              <figure>
                <img
                  src="/images/modelo-23_1.webp"
                  srcSet="/images/modelo-23-sm.webp 320w, /images/modelo-23_1.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt="Chinelo de crochê Arco-íris, entre nuvens"
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Arco-íris</figcaption>
              </figure>
              <figure>
                <img
                  src="/images/modelo-05_1.webp"
                  srcSet="/images/modelo-05-sm.webp 320w, /images/modelo-05_1.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt="Chinelo de crochê Hibisco Rosa, com tira verde menta"
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Hibisco Rosa</figcaption>
              </figure>
              <figure>
                <img
                  src="/images/modelo-17_1.webp"
                  srcSet="/images/modelo-17-sm.webp 320w, /images/modelo-17_1.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt="Chinelo de crochê Abacaxi, no chinelo marinho"
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Abacaxi</figcaption>
              </figure>
              <figure>
                <img
                  src="/images/modelo-24_1.webp"
                  srcSet="/images/modelo-24-sm.webp 320w, /images/modelo-24_1.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt="Chinelo de crochê Borboleta Azul, asas de leques"
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Borboleta Azul</figcaption>
              </figure>
              <figure>
                <img
                  src="/images/modelo-30_1.webp"
                  srcSet="/images/modelo-30-sm.webp 320w, /images/modelo-30_1.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt="Chinelo de crochê Roda de Rosinhas, com broche de pérolas"
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Roda de Rosinhas</figcaption>
              </figure>
              <figure>
                <img
                  src="/images/modelo-21.webp"
                  srcSet="/images/modelo-21-sm.webp 320w, /images/modelo-21.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt="Chinelo de crochê Estrela-do-mar, com tira verde-água"
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Estrela-do-mar</figcaption>
              </figure>
              <figure>
                <img
                  src="/images/modelo-08.webp"
                  srcSet="/images/modelo-08-sm.webp 320w, /images/modelo-08.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt="Chinelo de crochê Margaridinhas, em ponto pipoca"
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Margaridinhas</figcaption>
              </figure>
              <figure>
                <img
                  src="/images/modelo-32_1.webp"
                  srcSet="/images/modelo-32-sm.webp 320w, /images/modelo-32_1.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt="Chinelo de crochê Oncinha, em crochê tapeçaria"
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Oncinha</figcaption>
              </figure>
              <figure>
                <img
                  src="/images/modelo-36.webp"
                  srcSet="/images/modelo-36-sm.webp 320w, /images/modelo-36.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt="Chinelo de crochê Rosa de Bronze, com renda dourada"
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Rosa de Bronze</figcaption>
              </figure>
              <figure>
                <img
                  src="/images/modelo-14.webp"
                  srcSet="/images/modelo-14-sm.webp 320w, /images/modelo-14.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt="Chinelo de crochê Limãozinho, com tira verde fofinha"
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Limãozinho</figcaption>
              </figure>
              <figure>
                <img
                  src="/images/modelo-19.webp"
                  srcSet="/images/modelo-19-sm.webp 320w, /images/modelo-19.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt="Chinelo de crochê Bananinha, a tira vira banana"
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Bananinha</figcaption>
              </figure>
              <figure>
                <img
                  src="/images/modelo-11.webp"
                  srcSet="/images/modelo-11-sm.webp 320w, /images/modelo-11.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt="Chinelo de crochê Dália Vermelha, de três camadas"
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Dália Vermelha</figcaption>
              </figure>
              <figure>
                <img
                  src="/images/modelo-26.webp"
                  srcSet="/images/modelo-26-sm.webp 320w, /images/modelo-26.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt="Chinelo de crochê Laço Nude, clássico e delicado"
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Laço Nude</figcaption>
              </figure>

              {/* Duplicates for infinite loop */}
              <figure aria-hidden="true">
                <img
                  src="/images/modelo-01_1.webp"
                  srcSet="/images/modelo-01-sm.webp 320w, /images/modelo-01_1.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt=""
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Lírio Laranja</figcaption>
              </figure>
              <figure aria-hidden="true">
                <img
                  src="/images/modelo-12_1.webp"
                  srcSet="/images/modelo-12-sm.webp 320w, /images/modelo-12_1.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt=""
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Girassol</figcaption>
              </figure>
              <figure aria-hidden="true">
                <img
                  src="/images/modelo-15_1.webp"
                  srcSet="/images/modelo-15-sm.webp 320w, /images/modelo-15_1.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt=""
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Moranguinho</figcaption>
              </figure>
              <figure aria-hidden="true">
                <img
                  src="/images/modelo-23_1.webp"
                  srcSet="/images/modelo-23-sm.webp 320w, /images/modelo-23_1.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt=""
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Arco-íris</figcaption>
              </figure>
              <figure aria-hidden="true">
                <img
                  src="/images/modelo-05_1.webp"
                  srcSet="/images/modelo-05-sm.webp 320w, /images/modelo-05_1.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt=""
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Hibisco Rosa</figcaption>
              </figure>
              <figure aria-hidden="true">
                <img
                  src="/images/modelo-17_1.webp"
                  srcSet="/images/modelo-17-sm.webp 320w, /images/modelo-17_1.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt=""
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Abacaxi</figcaption>
              </figure>
              <figure aria-hidden="true">
                <img
                  src="/images/modelo-24_1.webp"
                  srcSet="/images/modelo-24-sm.webp 320w, /images/modelo-24_1.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt=""
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Borboleta Azul</figcaption>
              </figure>
              <figure aria-hidden="true">
                <img
                  src="/images/modelo-30_1.webp"
                  srcSet="/images/modelo-30-sm.webp 320w, /images/modelo-30_1.webp 520w"
                  sizes="(max-width:600px) 200px, 260px"
                  alt=""
                  width="520"
                  height="520"
                  loading="lazy"
                />
                <figcaption>Roda de Rosinhas</figcaption>
              </figure>
            </div>
            <div className="centro" style={{ marginTop: '34px' }}>
              <button className="btn ir-oferta" onClick={scrollToOferta}>
                QUERO APRENDER A FAZER
              </button>
            </div>
          </div>
        </section>

        {/* Pricing comparison / Profit potential ("Quanto vale um par pronto") */}
        <section className="vale">
          <div className="wrap centro">
            <span className="pill">Quanto vale um par pronto</span>
            <h2 style={{ margin: '16px 0 12px' }}>
              O chinelo liso custa pouco.{' '}
              <span className="script">Com crochê, passa de R$ 100.</span>
            </h2>
            <p className="sub">
              Veja quanto sai um par em material e quanto está sendo cobrado hoje por chinelo de
              crochê feito à mão.
            </p>

            <div className="conta">
              <div className="lado custo">
                <span className="rotulo">O que você gasta</span>
                <div className="valor">
                  R$ 25<small>de material por par, em média</small>
                </div>
                <ul>
                  <li>
                    par de chinelos lisos: <b>R$ 15</b>
                  </li>
                  <li>
                    barbante da tira e da aplicação: <b>R$ 8</b>
                  </li>
                  <li>
                    cola, embalagem e acabamento: <b>R$ 2</b>
                  </li>
                  <li>
                    a agulha você compra <b>uma vez só</b>
                  </li>
                </ul>
              </div>

              <div className="seta-conta" aria-hidden="true">
                →
              </div>

              <div className="lado venda">
                <span className="rotulo">O que estão cobrando</span>
                <div className="valor">
                  R$ 114 a R$ 151<small>por par, na Shopee</small>
                </div>
                <ul>
                  <li>
                    Havaianas listrado vermelho e branco: <b>R$ 133,00</b>{' '}
                    <span className="vendidos">· 31 vendidos</span>
                  </li>
                  <li>
                    maxi flor marrom: <b>R$ 142,50</b>{' '}
                    <span className="vendidos">· 13 vendidos</span>
                  </li>
                  <li>
                    flores verde e rosa: <b>R$ 142,50</b>{' '}
                    <span className="vendidos">· 15 vendidos</span>
                  </li>
                  <li>
                    flor laranja: <b>R$ 114,00</b>
                  </li>
                  <li>
                    maxi flor amarela: <b>R$ 151,05</b>
                  </li>
                </ul>
              </div>
            </div>

            <div className="numeros-vale">
              <div>
                <b>+R$ 89</b>
                <span>sobram por par, no anúncio mais barato, depois do material</span>
              </div>
              <div>
                <b>31 pares</b>
                <span>vendidos num anúncio só, a R$ 133 cada</span>
              </div>
              <div>
                <b>5x</b>
                <span>um par vendido a R$ 133 paga o material de 5 pares novos</span>
              </div>
            </div>

            <p className="chamada-provas">
              Veja os anúncios de verdade <span className="seta-baixo">↓</span>
            </p>
          </div>

          <div className="wrap">
            <div className="trilho provas" id="provas" ref={provasRef}>
              <figure>
                <img
                  src="/images/shopee-01.webp"
                  srcSet="/images/shopee-01_1.webp 340w, /images/shopee-01_2.webp 440w, /images/shopee-01.webp 520w"
                  sizes="(max-width:600px) 240px, 290px"
                  alt="Anúncio da Shopee de chinelo Havaianas customizado em crochê vermelho e branco, R$ 133,00 no Pix, com 31 vendidos"
                  width="520"
                  height="535"
                  loading="lazy"
                />
              </figure>
              <figure>
                <img
                  src="/images/shopee-02.webp"
                  srcSet="/images/shopee-02_1.webp 340w, /images/shopee-02_2.webp 440w, /images/shopee-02.webp 520w"
                  sizes="(max-width:600px) 240px, 290px"
                  alt="Anúncio da Shopee de chinelo com flor de crochê marrom, R$ 142,50 no Pix, com 13 vendidos"
                  width="520"
                  height="535"
                  loading="lazy"
                />
              </figure>
              <figure>
                <img
                  src="/images/shopee-03.webp"
                  srcSet="/images/shopee-03_2.webp 340w, /images/shopee-03_1.webp 440w, /images/shopee-03.webp 520w"
                  sizes="(max-width:600px) 240px, 290px"
                  alt="Anúncio da Shopee de chinelo customizado com flor de crochê laranja, R$ 114,00 no Pix"
                  width="520"
                  height="535"
                  loading="lazy"
                />
              </figure>
              <figure>
                <img
                  src="/images/shopee-04.webp"
                  srcSet="/images/shopee-04_1.webp 340w, /images/shopee-04_2.webp 440w, /images/shopee-04.webp 520w"
                  sizes="(max-width:600px) 240px, 290px"
                  alt="Anúncio da Shopee de chinelo Havaianas com maxi flor de crochê amarela, R$ 151,05 no Pix"
                  width="520"
                  height="535"
                  loading="lazy"
                />
              </figure>
              <figure>
                <img
                  src="/images/shopee-05.webp"
                  srcSet="/images/shopee-05_1.webp 340w, /images/shopee-05_2.webp 440w, /images/shopee-05.webp 520w"
                  sizes="(max-width:600px) 240px, 290px"
                  alt="Anúncio da Shopee de chinelo verde customizado em crochê, R$ 142,50 no Pix, com 15 vendidos"
                  width="520"
                  height="535"
                  loading="lazy"
                />
              </figure>

              {/* Duplicates */}
              <figure aria-hidden="true">
                <img
                  src="/images/shopee-01.webp"
                  srcSet="/images/shopee-01_1.webp 340w, /images/shopee-01_2.webp 440w, /images/shopee-01.webp 520w"
                  sizes="(max-width:600px) 240px, 290px"
                  alt=""
                  width="520"
                  height="535"
                  loading="lazy"
                />
              </figure>
              <figure aria-hidden="true">
                <img
                  src="/images/shopee-02.webp"
                  srcSet="/images/shopee-02_1.webp 340w, /images/shopee-02_2.webp 440w, /images/shopee-02.webp 520w"
                  sizes="(max-width:600px) 240px, 290px"
                  alt=""
                  width="520"
                  height="535"
                  loading="lazy"
                />
              </figure>
              <figure aria-hidden="true">
                <img
                  src="/images/shopee-03.webp"
                  srcSet="/images/shopee-03_2.webp 340w, /images/shopee-03_1.webp 440w, /images/shopee-03.webp 520w"
                  sizes="(max-width:600px) 240px, 290px"
                  alt=""
                  width="520"
                  height="535"
                  loading="lazy"
                />
              </figure>
            </div>
            <p className="nota-vale">
              Prints de anúncios reais da Shopee (preço no Pix), 11/10/2026. Custo: referência do
              guia de precificação que vem no Kit Completo; varia com a marca do chinelo e do
              barbante.
            </p>
            <div className="centro" style={{ marginTop: '30px' }}>
              <button className="btn ir-oferta" onClick={scrollToOferta}>
                QUERO FAZER OS MEUS
              </button>
            </div>
          </div>
        </section>

        {/* Bonuses Section */}
        <section className="bonus">
          <div className="wrap centro">
            <span className="pill no-escuro">Bônus inclusos</span>
            <h2 style={{ margin: '16px 0 12px' }}>
              E mais 5 bônus <span className="script">de presente</span>
            </h2>
            <p className="sub">
              Pra acertar o barbante no armarinho, deixar a tira sem a borracha aparecendo e saber
              quanto cobrar pelo par.
            </p>
            <span className="bonus-total-topo">
              Valem <s>R$ 197</s> <em>HOJE GRÁTIS</em>
            </span>

            <div className="bonus-lista">
              <div className="card-bonus">
                <div className="capa-bonus">
                  <span className="num-bonus">🧶 Bônus 1</span>
                  <img
                    src="/images/b1-barbantes.webp"
                    srcSet="/images/b1-barbantes-sm.webp 440w, /images/b1-barbantes-md.webp 720w, /images/b1-barbantes.webp 1100w"
                    sizes="(max-width:700px) 92vw, 540px"
                    alt="Capa do bônus Guia de Barbantes e Agulhas"
                    width="1100"
                    height="614"
                    loading="lazy"
                  />
                </div>
                <div className="txt-bonus">
                  <b>Guia de Barbantes e Agulhas</b>
                  <span className="desc">
                    Qual barbante deixa a tira macia e a flor firme, a agulha certa pra cada parte,
                    quanto fio vai em um par e os fios que é melhor evitar.
                  </span>
                  <span className="valor">
                    <span className="de">
                      Valor: <s>R$ 37</s>
                    </span>
                    <span className="gratis">GRÁTIS</span>
                  </span>
                </div>
              </div>

              <div className="card-bonus">
                <div className="capa-bonus">
                  <span className="num-bonus">✨ Bônus 2</span>
                  <img
                    src="/images/b2-acabamento.webp"
                    srcSet="/images/b2-acabamento-sm.webp 440w, /images/b2-acabamento-md.webp 720w, /images/b2-acabamento.webp 1100w"
                    sizes="(max-width:700px) 92vw, 540px"
                    alt="Capa do bônus Guia de Acabamento e Durabilidade"
                    width="1100"
                    height="614"
                    loading="lazy"
                  />
                </div>
                <div className="txt-bonus">
                  <b>Guia de Acabamento e Durabilidade</b>
                  <span className="desc">
                    Como fixar a aplicação pra não soltar, esconder as pontas do fio e lavar o
                    chinelo sem deformar. É o detalhe que faz o par parecer de loja.
                  </span>
                  <span className="valor">
                    <span className="de">
                      Valor: <s>R$ 47</s>
                    </span>
                    <span className="gratis">GRÁTIS</span>
                  </span>
                </div>
              </div>

              <div className="card-bonus">
                <div className="capa-bonus">
                  <span className="num-bonus">📖 Bônus 3</span>
                  <img
                    src="/images/b3-pontos.webp"
                    srcSet="/images/b3-pontos-sm.webp 440w, /images/b3-pontos-md.webp 720w, /images/b3-pontos.webp 1100w"
                    sizes="(max-width:700px) 92vw, 540px"
                    alt="Capa do bônus Pontos Básicos Ilustrados"
                    width="1100"
                    height="614"
                    loading="lazy"
                  />
                </div>
                <div className="txt-bonus">
                  <b>Pontos Básicos Ilustrados</b>
                  <span className="desc">
                    Correntinha, ponto baixo, meio ponto alto, ponto alto e anel mágico, desenhados
                    passo a passo. Pra quem nunca pegou numa agulha.
                  </span>
                  <span className="valor">
                    <span className="de">
                      Valor: <s>R$ 27</s>
                    </span>
                    <span className="gratis">GRÁTIS</span>
                  </span>
                </div>
              </div>

              <div className="card-bonus">
                <div className="capa-bonus">
                  <span className="num-bonus">💰 Bônus 4</span>
                  <img
                    src="/images/b4-precificar.webp"
                    srcSet="/images/b4-precificar-sm.webp 440w, /images/b4-precificar-md.webp 720w, /images/b4-precificar.webp 1100w"
                    sizes="(max-width:700px) 92vw, 540px"
                    alt="Capa do bônus Como Precificar e Vender"
                    width="1100"
                    height="614"
                    loading="lazy"
                  />
                </div>
                <div className="txt-bonus">
                  <b>Como Precificar e Vender</b>
                  <span className="desc">
                    A conta do custo real do par, quanto cobrar pelo seu tempo, como vender por
                    encomenda no número da cliente e as datas que mais vendem.
                  </span>
                  <span className="valor">
                    <span className="de">
                      Valor: <s>R$ 57</s>
                    </span>
                    <span className="gratis">GRÁTIS</span>
                  </span>
                </div>
              </div>

              <div className="card-bonus">
                <div className="capa-bonus">
                  <span className="num-bonus">🛒 Bônus 5</span>
                  <img
                    src="/images/b5-compras.webp"
                    srcSet="/images/b5-compras-sm.webp 440w, /images/b5-compras-md.webp 720w, /images/b5-compras.webp 1100w"
                    sizes="(max-width:700px) 92vw, 540px"
                    alt="Capa do bônus Lista de Compras da Iniciante"
                    width="1100"
                    height="614"
                    loading="lazy"
                  />
                </div>
                <div className="txt-bonus">
                  <b>Lista de Compras da Iniciante</b>
                  <span className="desc">
                    O que comprar primeiro, quanto comprar e onde. Você monta o kit inicial sem gastar
                    com o que não vai usar.
                  </span>
                  <span className="valor">
                    <span className="de">
                      Valor: <s>R$ 29</s>
                    </span>
                    <span className="gratis">GRÁTIS</span>
                  </span>
                </div>
              </div>

              <div className="card-bonus juntos">
                <div className="txt-bonus">
                  <span className="presente">🎁</span>
                  <b>Os 5 vêm no Kit Completo</b>
                  <span className="desc">
                    Separados, sairiam R$ 197. No Kit Completo, entram sem custo nenhum a mais.
                  </span>
                  <span className="soma">
                    Somando tudo: <s>R$ 197</s>
                  </span>
                  <span className="hoje">
                    R$ 0<small>no Kit Completo</small>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing & Checkout Options ("A oferta") */}
        <section className="oferta" id="oferta">
          <div className="wrap centro">
            <span className="pill">A oferta</span>
            <h2 style={{ margin: '16px 0 12px' }}>
              Escolha <span className="script">o seu kit</span>
            </h2>
            {/* ViewContent & scroll target marker directly before pricing cards */}
            <div
              id="marcador-planos"
              aria-hidden="true"
              style={{ width: '100%', height: '1px', pointerEvents: 'none' }}
            />
            <div className="planos">
              {/* Kit Básico */}
              <div className="plano">
                <div className="plano-nome">Kit Básico</div>
                <div className="plano-preco">
                  <small>R$</small>10
                </div>
                <p className="plano-obs">Só os 40 modelos.</p>
                <ul className="inclui">
                  <li>
                    <span className="ckm">✓</span> Os 40 modelos completos
                  </li>
                  <li>
                    <span className="ckm">✓</span> Gráfico e receita da aplicação
                  </li>
                  <li>
                    <span className="ckm">✓</span> Tabela de tamanhos do 33 ao 42
                  </li>
                  <li>
                    <span className="ckm">✓</span> Em PDF, no celular ou impresso
                  </li>
                  <li>
                    <span className="ckm">✓</span> Acesso imediato e vitalício
                  </li>
                </ul>
                <button
                  type="button"
                  className="btn full btn-simples"
                  id="btn-essencial"
                  onClick={() => setShowUpsell(true)}
                >
                  QUERO SÓ OS MODELOS
                </button>
                <p className="microaviso">
                  <span className="desk">→ com mais R$ 15,90 você leva os 5 bônus</span>
                  <span className="mob">↓ com mais R$ 15,90 você leva os 5 bônus</span>
                </p>
              </div>

              {/* Kit Completo */}
              <div className="plano destaque">
                <span className="fita">Preço de lançamento</span>
                <div className="plano-nome">Kit Completo</div>
                <div className="linha-ancora">
                  <s>R$ 99,90</s>
                  <span className="economize">Economize R$ 74</span>
                </div>
                <div className="plano-preco">
                  <small>R$</small>25,90
                </div>
                <p className="plano-obs">Os 40 modelos e os 5 bônus.</p>
                <div className="timer">
                  ⏱ A oferta expira em: <b>{formatTimer(secondsLeft)}</b>
                </div>
                <ul className="inclui">
                  <li>
                    <span className="ckm">✓</span> Os 40 modelos completos
                  </li>
                  <li>
                    <span className="ckm">✓</span> Gráfico e receita da aplicação
                  </li>
                  <li>
                    <span className="ckm">✓</span> Tabela de tamanhos do 33 ao 42
                  </li>
                  <li>
                    <span className="ckm">✓</span> Em PDF, no celular ou impresso
                  </li>
                  <li>
                    <span className="ckm">✓</span> Acesso imediato e vitalício
                  </li>
                </ul>
                <hr className="divisor" />
                <div className="titulo-bonus">🎁 Bônus inclusos</div>
                <ul className="lista-bonus">
                  <li>
                    🎁 <span><b>BÔNUS 1:</b> Guia de Barbantes e Agulhas</span>
                  </li>
                  <li>
                    🎁 <span><b>BÔNUS 2:</b> Guia de Acabamento e Durabilidade</span>
                  </li>
                  <li>
                    🎁 <span><b>BÔNUS 3:</b> Pontos Básicos Ilustrados</span>
                  </li>
                  <li>
                    🎁 <span><b>BÔNUS 4:</b> Como Precificar e Vender</span>
                  </li>
                  <li>
                    🎁 <span><b>BÔNUS 5:</b> Lista de Compras da Iniciante</span>
                  </li>
                </ul>
                <a
                  href={checkoutLinks.completo}
                  className="btn full"
                  id="btn-completo"
                  target="_top"
                  onClick={() => {
                    if (typeof window !== 'undefined') window.__indoParaCheckout = true;
                  }}
                >
                  QUERO O KIT COMPLETO
                </a>
                <div className="selos-pgto">
                  <span>🔒 Compra segura</span>
                  <span>🛡️ 7 dias de garantia</span>
                  <span>⚡ Entrega imediata</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Upsell Modal */}
        {showUpsell && (
          <div className="modal" id="upsell">
            <div className="modal-fundo" onClick={() => setShowUpsell(false)} />
            <div
              className="modal-caixa"
              role="dialog"
              aria-modal="true"
              aria-labelledby="upsell-titulo"
            >
              <button
                className="modal-x"
                aria-label="Fechar"
                onClick={() => setShowUpsell(false)}
              >
                ×
              </button>
              <h3 id="upsell-titulo">Espera, antes de ir</h3>
              <p className="modal-sub">
                Por <b>mais R$ 6,90</b> você leva os 5 bônus junto. Esse preço só aparece aqui.
              </p>
              <div className="modal-preco">
                <s>R$ 25,90</s>
                <div className="modal-valor">
                  <small>R$</small>16,90
                </div>
                <span>Kit Completo, com os 5 bônus</span>
              </div>
              <a
                href={checkoutLinks.upsellComBonus}
                className="btn full"
                id="upsell-sim"
                target="_top"
                onClick={() => {
                  if (typeof window !== 'undefined') window.__indoParaCheckout = true;
                }}
              >
                QUERO COM OS BÔNUS
              </a>
              <a
                href={checkoutLinks.basico}
                className="modal-nao"
                id="upsell-nao"
                target="_top"
                style={{ textDecoration: 'none', display: 'block', textAlign: 'center' }}
                onClick={() => {
                  if (typeof window !== 'undefined') window.__indoParaCheckout = true;
                }}
              >
                Não, quero só os modelos
              </a>
            </div>
          </div>
        )}

        {/* Recipe Page Zoom Modal */}
        {zoomImg && (
          <div className="zoom" id="zoom" onClick={() => setZoomImg(null)}>
            <button
              className="zoom-x"
              type="button"
              aria-label="Fechar"
              onClick={() => setZoomImg(null)}
            >
              ×
            </button>
            <img src={zoomImg.src} alt={zoomImg.alt} onClick={(e) => e.stopPropagation()} />
          </div>
        )}

        {/* Warranty Section */}
        <section className="garantia">
          <div className="wrap estreito">
            <div className="g-box">
              <div className="selo">
                <b>7</b>
                <span>dias</span>
              </div>
              <div>
                <h3>Não gostou? Eu devolvo.</h3>
                <p>
                  Baixe, escolha um modelo e comece. Se em 7 dias achar que não é pra você, me manda
                  um e-mail e eu devolvo o valor inteiro. Não precisa explicar o motivo.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="faq">
          <div className="wrap centro">
            <span className="pill">Dúvidas</span>
            <h2 style={{ margin: '16px 0 12px' }}>
              Ainda ficou <span className="script">alguma dúvida?</span>
            </h2>
            <div className="lista-faq">
              <details open>
                <summary>Nunca fiz crochê. Consigo mesmo assim?</summary>
                <p>
                  Consegue. Cada modelo tem o nível indicado, e os de nível iniciante usam só ponto
                  baixo na tira e uma aplicação simples. O bônus de Pontos Básicos mostra,
                  desenhado, cada ponto usado nas receitas.
                </p>
              </details>
              <details>
                <summary>Serve pra qualquer número de chinelo?</summary>
                <p>
                  Serve do 33/34 ao 41/42. Cada modelo tem uma tabela com quantos pontos vão em cada
                  lado da tira pra cada número, então você faz no seu tamanho ou no da cliente.
                </p>
              </details>
              <details>
                <summary>Que chinelo eu uso?</summary>
                <p>
                  Um chinelo de dedo liso, de borracha, desses de qualquer loja. O crochê cobre a
                  tira e a aplicação vai por cima, então não precisa ser de marca.
                </p>
              </details>
              <details>
                <summary>Que material eu preciso comprar?</summary>
                <p>
                  Barbante de algodão nº 6 nas cores do modelo, agulha de crochê de 3,5 mm e 4,0 mm,
                  agulha de tapeçaria, tesoura e cola para tecido. Cada receita traz a lista exata
                  do par. Se está começando do zero, o bônus Lista de Compras mostra o que comprar
                  primeiro.
                </p>
              </details>
              <details>
                <summary>Como recebo o material?</summary>
                <p>
                  Por e-mail, logo depois que o pagamento é aprovado. Costuma chegar em poucos
                  minutos. Você baixa quantas vezes quiser e o acesso não vence.
                </p>
              </details>
              <details>
                <summary>Preciso de impressora?</summary>
                <p>
                  Não. Dá pra seguir tudo no celular, dando zoom no gráfico da carreira que está
                  fazendo. Se preferir papel, as páginas imprimem bem.
                </p>
              </details>
              <details>
                <summary>Posso vender os chinelos que eu fizer?</summary>
                <p>
                  Pode. Os chinelos que você fizer são seus, e o bônus de precificação ensina quanto
                  cobrar. Só não pode repassar ou revender os arquivos das receitas.
                </p>
              </details>
              <details>
                <summary>Qual a diferença entre os dois kits?</summary>
                <p>
                  O Básico tem os 40 modelos. O Completo tem os 40 modelos e os 5 bônus: Guia de
                  Barbantes e Agulhas, Guia de Acabamento e Durabilidade, Pontos Básicos Ilustrados,
                  Como Precificar e Vender e Lista de Compras da Iniciante.
                </p>
              </details>
              <details>
                <summary>E se eu não gostar?</summary>
                <p>
                  Você pede o reembolso por e-mail em até 7 dias e recebe o valor inteiro de volta,
                  sem precisar explicar nada.
                </p>
              </details>
            </div>
          </div>
        </section>

        {/* Final CTA Section */}
        <section className="final">
          <div className="wrap">
            <h2>
              Seu primeiro par pode ficar pronto <span className="script">ainda esta semana</span>
            </h2>
            <p className="sub">
              Escolha o modelo, separe o barbante que ele pede e comece. Quando perguntarem onde você
              comprou, você já sabe o que responder.
            </p>
            <div className="caixa-final">
              <div className="de-final">
                <s>De R$ 99,90</s>
              </div>
              <div className="preco-final">
                <small>R$</small>25,90
              </div>
              <div className="de-final">pagamento único · acesso vitalício</div>
              <button className="btn full ir-oferta" onClick={scrollToOferta}>
                QUERO COMEÇAR AGORA
              </button>
              <div className="selos-pgto">
                <span>🔒 Compra segura</span>
                <span>🛡️ 7 dias de garantia</span>
                <span>⚡ Entrega imediata</span>
              </div>
            </div>
            <p className="assinatura">
              Dúvidas depois da compra? Responda o e-mail de confirmação que a gente te ajuda.
            </p>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <p>
            <b>40 Modelos de Chinelos de Crochê</b> · Todos os direitos reservados.
          </p>
        </div>
      </footer>
    </>
  );
}
