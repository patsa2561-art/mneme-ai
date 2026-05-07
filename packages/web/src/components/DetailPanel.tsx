import type { NervousSystemData, PassportData } from "../types";

interface Props {
  passport: PassportData | null;
  fallbackData: NervousSystemData | null;
  onClose: () => void;
}

export function DetailPanel({ passport, fallbackData, onClose }: Props) {
  if (!passport) {
    return <Hero data={fallbackData} />;
  }
  const id = passport.identity;
  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <div className="detail-name">{id.name}</div>
          <div className="detail-email">{id.email}</div>
        </div>
        <button className="detail-close" onClick={onClose} aria-label="Close passport">
          ×
        </button>
      </div>

      <div className="detail-stat-grid">
        <Stat label="commits" value={String(id.commitCount)} />
        <Stat
          label="commit share"
          value={`${(id.repoCommitShare * 100).toFixed(1)}%`}
        />
        <Stat label="active days" value={String(id.activeDays)} />
        <Stat label="dna" value={id.dnaHash.slice(0, 7)} mono />
      </div>

      <Section title="Knowledge">
        <div className="detail-row">
          <span>knowledge mass</span>
          <b>{passport.expertise.knowledgeMass.toFixed(2)}</b>
        </div>
        <div className="detail-row">
          <span>files known</span>
          <b>
            {passport.expertise.filesStillFresh} fresh /{" "}
            {passport.expertise.filesKnown} total
          </b>
        </div>
      </Section>

      <Section title="Top expertise">
        {passport.expertise.topFiles.length === 0 ? (
          <div className="detail-empty">no expertise files at this point in time</div>
        ) : (
          <ul className="detail-files">
            {passport.expertise.topFiles.slice(0, 8).map((f) => (
              <li key={f.filePath} className={`band-${f.band}`}>
                <span className="band-dot" />
                <code className="detail-file-path">{f.filePath}</code>
                <span className="detail-file-knowledge">
                  {Math.round(f.knowledge * 100)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {passport.influenceSlot && (
        <Section title="Influence">
          <div className="detail-row">
            <span>rank</span>
            <b>
              #{passport.influenceSlot.rank} of {passport.influenceSlot.rankedOf}
            </b>
          </div>
          <div className="detail-row">
            <span>page rank</span>
            <b>{passport.influenceSlot.pageRank.toFixed(3)}</b>
          </div>
          <div className="detail-row">
            <span>adoptions by others</span>
            <b>
              {passport.influenceSlot.adoptionsByOthers} ·{" "}
              {passport.influenceSlot.uniqueAdopters} adopters
            </b>
          </div>
        </Section>
      )}

      {passport.telepathySlot.pairs.length > 0 && (
        <Section title="Latent collaborators">
          <ul className="detail-pairs">
            {passport.telepathySlot.pairs.slice(0, 4).map((p, i) => {
              const other =
                p.authorA.email.toLowerCase() === id.email.toLowerCase()
                  ? p.authorB
                  : p.authorA;
              return (
                <li key={i}>
                  <span className="detail-pair-name">{other.name}</span>
                  <span className="detail-pair-meta">
                    {p.events} rhymes · {p.topTopic.topic}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {passport.voice && passport.voice.length > 0 && (
        <Section title="Voice fingerprint">
          <div className="detail-voice">
            {passport.voice.slice(0, 6).map((v) => (
              <span
                key={v.phrase}
                className="detail-voice-chip"
                style={{ fontSize: `${0.78 + Math.min(0.4, v.weight)}em` }}
                title={`${v.count}× in commits`}
              >
                {v.phrase}
              </span>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="detail-section">
      <h4 className="detail-section-title">{title}</h4>
      {children}
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="stat">
      <div className={`stat-value ${mono ? "mono" : ""}`}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function Hero({ data }: { data: NervousSystemData | null }) {
  if (!data) {
    return (
      <div className="detail">
        <div className="detail-hero-empty">
          <h3>Click any node to inspect a passport.</h3>
          <p>Drag the time scrubber to rewind the codebase.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="detail">
      <div className="detail-hero-head">
        <h3 className="detail-hero-headline">{data.hero.headline}</h3>
        <p className="detail-hero-blurb">{data.meta.repoName}</p>
      </div>
      <div className="detail-hero-metrics">
        {data.hero.metrics.map((m) => (
          <div key={m.label} className="detail-metric">
            <div className="detail-metric-value">{m.value}</div>
            <div className="detail-metric-label">{m.label}</div>
            <div className="detail-metric-sub">{m.subtitle}</div>
            <Sparkline data={m.sparkline} />
          </div>
        ))}
      </div>
      {data.surprising && data.surprising.length > 0 && (
        <Section title="Surprising">
          <ul className="detail-surprising">
            {data.surprising.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length === 0) return null;
  const w = 120;
  const h = 28;
  const max = Math.max(1, ...data);
  const points = data
    .map((v, i) => {
      const x = (i / Math.max(1, data.length - 1)) * w;
      const y = h - (v / max) * (h - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="sparkline" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline
        points={points}
        fill="none"
        stroke="#7c3aed"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
