(function (global) {
  'use strict';

  const PRACTICE_KEY = 'TEACHLOOP_AUTO_PRACTICE';

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const CHART_COLORS = ['#7FC8FF', '#84A15B', '#E88A7A', '#F5A623', '#C4B5FD', '#34D399'];

  function shortChartLabel(label) {
    let t = String(label || '').trim();
    // Drop leading date fragments so the pill stays short like the design
    t = t.replace(/^(early|mid|late)\s+\d{3,4}(-\d{2,4})?\s*[:\-–—]\s*/i, '');
    t = t.replace(/^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{3,4}\s*[:\-–—]\s*/i, '');
    t = t.replace(/^\d{3,4}(-\d{2,4})?\s*[:\-–—]\s*/i, '');
    // Prefer whole words — never cut mid-word with an ellipsis
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length > 4) t = words.slice(0, 4).join(' ');
    else if (t.length > 36) {
      const cut = t.slice(0, 36);
      const sp = cut.lastIndexOf(' ');
      t = (sp > 16 ? cut.slice(0, sp) : cut).trim();
    }
    return t || String(label || '').split(/\s+/).slice(0, 3).join(' ');
  }

  function termMeta(t) {
    if (!t) return null;
    if (typeof t === 'string') return { term: t, def: '' };
    return { term: t.term || t.word || '', def: t.def || t.definition || t.meaning || '' };
  }

  const IMG_CACHE_KEY = 'TEACHLOOP_IMG_CACHE_V3';

  function parseDiagramLabels(caption, query, title) {
    const raw = String(caption || '').trim();
    let parts = raw
      .split(/\s*[,;|/]\s*|\s+and\s+/i)
      .map(function (x) { return x.replace(/\.$/, '').trim(); })
      .filter(function (x) { return x && x.length > 1 && x.length < 42; });
    if (parts.length < 2) {
      const q = String(query || title || 'Key parts').trim();
      parts = [q.split(/\s+/).slice(0, 3).join(' ') || 'Structure'];
    }
    return parts.slice(0, 6);
  }

  // Real topic-aware, high-contrast SVG diagrams with clean typography & domain-specific visuals
  function buildLabeledDiagramSvg(title, labels) {
    const w = 960;
    const h = 720;
    const cx = 480;
    const cy = 360;
    const labs = (labels && labels.length ? labels : ['Key Concept', 'Structure', 'Mechanism', 'Application']).slice(0, 6);
    const left = labs.filter(function (_, i) { return i % 2 === 0; });
    const right = labs.filter(function (_, i) { return i % 2 === 1; });

    const rawTitle = String(title || 'Conceptual Diagram').slice(0, 52);
    const textForMatch = (rawTitle + ' ' + labs.join(' ')).toLowerCase();

    function escXml(s) {
      return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // Determine domain category & visual archetype
    let domain = 'general';
    let subTitle = 'CONCEPTUAL ARCHITECTURE & SYSTEM MATRIX';
    let colors = ['#6366F1', '#06B6D4', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6'];
    let bgFill = '#FAFAFA';
    let centerSvg = '';

    // 1. ECONOMICS / SPECIALIZATION / BUSINESS / PRODUCTION / MARKETS
    if (/specializ|division of lab|roaster|barista|coffee|assembly|manufactur|product line|trade|firm|business|retail|supply chain/i.test(textForMatch)) {
      domain = 'specialization';
      subTitle = 'ECONOMIC SPECIALIZATION & PRODUCTION WORKFLOW';
      colors = ['#059669', '#0284C7', '#7C3AED', '#D97706', '#2563EB', '#0D9488'];
      
      // Multi-stage specialized production & workflow pipeline
      centerSvg += '<rect x="290" y="190" width="380" height="340" rx="24" fill="#F0FDF4" stroke="#059669" stroke-width="4"/>';
      // Flow track pipes
      centerSvg += '<path d="M340 260 H440 V360 H520 V460 H620" fill="none" stroke="#10B981" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>';
      centerSvg += '<path d="M340 460 H440 V360 H520 V260 H620" fill="none" stroke="#0284C7" stroke-width="4" stroke-dasharray="8 6" stroke-linecap="round"/>';
      
      // Stage 1: Input / Sourcing Hub
      centerSvg += '<rect x="310" y="230" width="65" height="65" rx="14" fill="#FFFFFF" stroke="#059669" stroke-width="3"/>';
      centerSvg += '<circle cx="342" cy="262" r="14" fill="#D1FAE5"/>';
      centerSvg += '<text x="342" y="267" text-anchor="middle" font-size="11" font-weight="900" fill="#047857">INPUT</text>';
      
      // Stage 2: Processing & Roasting Core (Gears & heat module)
      centerSvg += '<rect x="440" y="320" width="80" height="80" rx="18" fill="#FFFFFF" stroke="#7C3AED" stroke-width="3.5"/>';
      centerSvg += '<circle cx="480" cy="360" r="24" fill="#EDE9FE" stroke="#8B5CF6" stroke-width="2"/>';
      centerSvg += '<circle cx="480" cy="360" r="12" fill="#7C3AED"/>';
      centerSvg += '<text x="480" y="415" text-anchor="middle" font-size="10" font-weight="800" fill="#5B21B6">SPECIALIZED CORE</text>';

      // Stage 3: Extraction & Assembly Station
      centerSvg += '<rect x="585" y="230" width="65" height="65" rx="14" fill="#FFFFFF" stroke="#0284C7" stroke-width="3"/>';
      centerSvg += '<circle cx="617" cy="262" r="14" fill="#E0F2FE"/>';
      centerSvg += '<text x="617" y="267" text-anchor="middle" font-size="11" font-weight="900" fill="#0369A1">PROCESS</text>';

      // Stage 4: Output / Value Terminal
      centerSvg += '<rect x="585" y="425" width="65" height="65" rx="14" fill="#FFFFFF" stroke="#D97706" stroke-width="3"/>';
      centerSvg += '<circle cx="617" cy="457" r="14" fill="#FEF3C7"/>';
      centerSvg += '<text x="617" y="462" text-anchor="middle" font-size="11" font-weight="900" fill="#B45309">VALUE</text>';

      // Pulse flow markers
      centerSvg += '<circle cx="390" cy="260" r="6" fill="#10B981"/><circle cx="480" cy="310" r="6" fill="#7C3AED"/><circle cx="570" cy="460" r="6" fill="#D97706"/>';
      
    } else if (/supply|demand|equilibrium|elasticit|market|price|cost|monopol|surplus|shortage|macroeconom|microeconom|gdp|inflation/i.test(textForMatch)) {
      domain = 'economics_market';
      subTitle = 'MARKET EQUILIBRIUM & PRICE DYNAMICS';
      colors = ['#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#0284C7'];

      // Coordinate axes for Price vs Quantity
      centerSvg += '<rect x="290" y="190" width="380" height="340" rx="20" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="3"/>';
      centerSvg += '<line x1="340" y1="480" x2="630" y2="480" stroke="#334155" stroke-width="3" stroke-linecap="round"/>';
      centerSvg += '<line x1="340" y1="480" x2="340" y2="230" stroke="#334155" stroke-width="3" stroke-linecap="round"/>';
      centerSvg += '<text x="330" y="240" text-anchor="end" font-size="14" font-weight="800" fill="#334155">Price (P)</text>';
      centerSvg += '<text x="630" y="505" text-anchor="end" font-size="14" font-weight="800" fill="#334155">Quantity (Q)</text>';

      // Supply Curve (Upward) & Demand Curve (Downward)
      centerSvg += '<path d="M370 450 Q480 350 590 250" fill="none" stroke="#2563EB" stroke-width="4.5" stroke-linecap="round"/>';
      centerSvg += '<text x="600" y="255" font-size="16" font-weight="900" fill="#2563EB">S</text>';
      centerSvg += '<path d="M370 250 Q480 350 590 450" fill="none" stroke="#DC2626" stroke-width="4.5" stroke-linecap="round"/>';
      centerSvg += '<text x="600" y="455" font-size="16" font-weight="900" fill="#DC2626">D</text>';

      // Equilibrium Intersection Point
      centerSvg += '<line x1="340" y1="350" x2="480" y2="350" stroke="#64748B" stroke-width="2" stroke-dasharray="5 5"/>';
      centerSvg += '<line x1="480" y1="350" x2="480" y2="480" stroke="#64748B" stroke-width="2" stroke-dasharray="5 5"/>';
      centerSvg += '<circle cx="480" cy="350" r="12" fill="#059669" stroke="#FFFFFF" stroke-width="3"/>';
      centerSvg += '<circle cx="480" cy="350" r="5" fill="#FFFFFF"/>';
      centerSvg += '<text x="500" y="340" font-size="13" font-weight="800" fill="#059669">Equilibrium (E*)</text>';

    } else if (/photosynthesis|chloroplast|chlorophyll|thylakoid|grana|stroma|calvin|plant bio|leaf/i.test(textForMatch)) {
      domain = 'photosynthesis';
      subTitle = 'PHOTOSYNTHESIS & BIOCHEMICAL PATHWAY';
      colors = ['#10B981', '#059669', '#84CC16', '#F59E0B', '#06B6D4', '#6366F1'];

      // Chloroplast double membrane cross-section
      centerSvg += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="180" ry="160" fill="#ECFDF5" stroke="#059669" stroke-width="5"/>';
      centerSvg += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="164" ry="145" fill="#F0FDF4" stroke="#10B981" stroke-width="3"/>';
      
      // Thylakoid Grana Discs Stacks (Green coin stacks)
      function drawGranum(gx, gy) {
        let g = '';
        for (let k = 0; k < 4; k++) {
          g += '<ellipse cx="' + gx + '" cy="' + (gy + k * 12) + '" rx="26" ry="8" fill="#10B981" stroke="#047857" stroke-width="2"/>';
        }
        return g;
      }
      centerSvg += drawGranum(390, 310);
      centerSvg += drawGranum(430, 370);
      centerSvg += drawGranum(400, 420);
      // Stroma lamellae bridges
      centerSvg += '<path d="M410 330 Q440 350 430 390" fill="none" stroke="#34D399" stroke-width="3"/>';

      // Calvin Cycle Rotating Ring (Light Independent Reaction)
      centerSvg += '<circle cx="550" cy="360" r="46" fill="none" stroke="#F59E0B" stroke-width="3.5" stroke-dasharray="8 5"/>';
      centerSvg += '<polygon points="596,360 588,350 604,350" fill="#F59E0B"/>';
      centerSvg += '<circle cx="550" cy="360" r="20" fill="#FEF3C7"/>';
      centerSvg += '<text x="550" y="364" text-anchor="middle" font-size="10" font-weight="900" fill="#B45309">CALVIN</text>';

      // Sunlight Photon Ray input
      centerSvg += '<path d="M330 230 L370 280" fill="none" stroke="#FBBF24" stroke-width="4" stroke-linecap="round"/>';
      centerSvg += '<circle cx="330" cy="230" r="8" fill="#F59E0B"/>';
      centerSvg += '<text x="320" y="215" font-size="12" font-weight="800" fill="#D97706">Sunlight (hv)</text>';

    } else if (/dna|rna|gene|genetics|chromosome|nucleotide|adenine|thymine|guanine|cytosine|helix|replication/i.test(textForMatch)) {
      domain = 'genetics';
      subTitle = 'DNA MOLECULAR STRUCTURE & GENETICS';
      colors = ['#06B6D4', '#8B5CF6', '#4F46E5', '#F43F5E', '#10B981', '#F59E0B'];

      // Double Helix Structural Strands
      centerSvg += '<rect x="300" y="190" width="360" height="340" rx="20" fill="#F5F3FF" stroke="#8B5CF6" stroke-width="3.5"/>';
      // Helical Backbones
      centerSvg += '<path d="M360 220 C420 270, 420 330, 360 380 C300 430, 300 470, 360 500" fill="none" stroke="#06B6D4" stroke-width="5" stroke-linecap="round"/>';
      centerSvg += '<path d="M600 220 C540 270, 540 330, 600 380 C660 430, 660 470, 600 500" fill="none" stroke="#8B5CF6" stroke-width="5" stroke-linecap="round"/>';

      // Base pair rungs (A-T, G-C)
      const rungs = [
        {y: 250, c1: '#10B981', c2: '#F43F5E', t1: 'A', t2: 'T'},
        {y: 290, c1: '#8B5CF6', c2: '#06B6D4', t1: 'G', t2: 'C'},
        {y: 330, c1: '#F43F5E', c2: '#10B981', t1: 'T', t2: 'A'},
        {y: 370, c1: '#06B6D4', c2: '#8B5CF6', t1: 'C', t2: 'G'},
        {y: 410, c1: '#10B981', c2: '#F43F5E', t1: 'A', t2: 'T'},
        {y: 450, c1: '#8B5CF6', c2: '#06B6D4', t1: 'G', t2: 'C'}
      ];
      rungs.forEach(function(r) {
        centerSvg += '<line x1="390" y1="' + r.y + '" x2="475" y2="' + r.y + '" stroke="' + r.c1 + '" stroke-width="4"/>';
        centerSvg += '<line x1="485" y1="' + r.y + '" x2="570" y2="' + r.y + '" stroke="' + r.c2 + '" stroke-width="4"/>';
        centerSvg += '<circle cx="480" cy="' + r.y + '" r="5" fill="#FFFFFF" stroke="#4F46E5" stroke-width="2"/>';
        centerSvg += '<text x="430" y="' + (r.y - 6) + '" text-anchor="middle" font-size="10" font-weight="900" fill="' + r.c1 + '">' + r.t1 + '</text>';
        centerSvg += '<text x="530" y="' + (r.y - 6) + '" text-anchor="middle" font-size="10" font-weight="900" fill="' + r.c2 + '">' + r.t2 + '</text>';
      });

    } else if (/heart|cardio|blood|artery|vein|ventricle|atrium|aorta|pulmonary|circulat/i.test(textForMatch)) {
      domain = 'cardio';
      subTitle = 'CARDIOVASCULAR ANATOMY & BLOOD FLOW';
      colors = ['#EF4444', '#2563EB', '#DC2626', '#1D4ED8', '#9333EA', '#D97706'];

      // Heart chambers & vessels cross-section
      centerSvg += '<path d="M480 230 C420 180, 320 220, 320 330 C320 420, 430 490, 480 520 C530 490, 640 420, 640 330 C640 220, 540 180, 480 230 Z" fill="#FEF2F2" stroke="#DC2626" stroke-width="5"/>';
      // Septum divider
      centerSvg += '<path d="M480 260 V490" stroke="#B91C1C" stroke-width="5" stroke-linecap="round"/>';
      
      // Left / Right Atria & Ventricles
      centerSvg += '<circle cx="410" cy="300" r="32" fill="#DBEAFE" stroke="#2563EB" stroke-width="2.5"/>';
      centerSvg += '<text x="410" y="305" text-anchor="middle" font-size="11" font-weight="800" fill="#1E40AF">R. Atrium</text>';
      centerSvg += '<circle cx="550" cy="300" r="32" fill="#FEE2E2" stroke="#DC2626" stroke-width="2.5"/>';
      centerSvg += '<text x="550" y="305" text-anchor="middle" font-size="11" font-weight="800" fill="#991B1B">L. Atrium</text>';

      centerSvg += '<circle cx="410" cy="400" r="38" fill="#BFDBFE" stroke="#1D4ED8" stroke-width="2.5"/>';
      centerSvg += '<text x="410" y="405" text-anchor="middle" font-size="11" font-weight="800" fill="#1E40AF">R. Ventricle</text>';
      centerSvg += '<circle cx="550" cy="400" r="38" fill="#FECACA" stroke="#B91C1C" stroke-width="2.5"/>';
      centerSvg += '<text x="550" y="405" text-anchor="middle" font-size="11" font-weight="800" fill="#991B1B">L. Ventricle</text>';

      // Directional Flow Arrows
      centerSvg += '<path d="M410 260 V360" fill="none" stroke="#2563EB" stroke-width="3" stroke-linecap="round"/>';
      centerSvg += '<path d="M550 260 V360" fill="none" stroke="#DC2626" stroke-width="3" stroke-linecap="round"/>';

    } else if (/wave|wavelength|frequenc|amplitude|optic|light|refract|reflect|prism|spectrum|diffraction|lens|laser/i.test(textForMatch)) {
      domain = 'physics_waves';
      subTitle = 'WAVE DYNAMICS & OPTICAL DISPERSION';
      colors = ['#0284C7', '#4F46E5', '#7C3AED', '#EC4899', '#F59E0B', '#10B981'];

      centerSvg += '<rect x="290" y="190" width="380" height="340" rx="20" fill="#F0F9FF" stroke="#0284C7" stroke-width="3.5"/>';
      // Harmonic Sine Wave
      centerSvg += '<path d="M310 320 C340 230, 380 230, 410 320 C440 410, 480 410, 510 320 C540 230, 580 230, 610 320 C640 410, 660 410, 670 320" fill="none" stroke="#0284C7" stroke-width="4.5" stroke-linecap="round"/>';
      // Center Baseline Axis
      centerSvg += '<line x1="310" y1="320" x2="650" y2="320" stroke="#94A3B8" stroke-width="2" stroke-dasharray="6 4"/>';
      
      // Wavelength & Amplitude Brackets
      centerSvg += '<line x1="360" y1="215" x2="560" y2="215" stroke="#7C3AED" stroke-width="2.5"/>';
      centerSvg += '<circle cx="360" cy="215" r="4" fill="#7C3AED"/><circle cx="560" cy="215" r="4" fill="#7C3AED"/>';
      centerSvg += '<text x="460" y="205" text-anchor="middle" font-size="12" font-weight="900" fill="#6D28D9">Wavelength (λ)</text>';

      centerSvg += '<line x1="410" y1="320" x2="410" y2="410" stroke="#EC4899" stroke-width="2.5"/>';
      centerSvg += '<text x="420" y="370" font-size="11" font-weight="800" fill="#BE185D">Amplitude (A)</text>';

      // Optical Prism refraction
      centerSvg += '<polygon points="480,420 440,500 520,500" fill="#FFFFFF" stroke="#4F46E5" stroke-width="3"/>';
      centerSvg += '<line x1="410" y1="470" x2="455" y2="465" stroke="#F59E0B" stroke-width="3"/>';
      centerSvg += '<path d="M490 465 L560 445" stroke="#EF4444" stroke-width="2"/>';
      centerSvg += '<path d="M490 465 L560 465" stroke="#10B981" stroke-width="2"/>';
      centerSvg += '<path d="M490 465 L560 485" stroke="#6366F1" stroke-width="2"/>';

    } else if (/force|gravity|friction|velocity|accelerat|newton|momentum|vector|kinematic|incline|trajectory|torque/i.test(textForMatch)) {
      domain = 'physics_mechanics';
      subTitle = 'PHYSICAL MECHANICS & FORCE VECTORS';
      colors = ['#EA580C', '#2563EB', '#16A34A', '#9333EA', '#0284C7', '#D97706'];

      // Inclined plane mechanics
      centerSvg += '<rect x="290" y="190" width="380" height="340" rx="20" fill="#FFF7ED" stroke="#EA580C" stroke-width="3.5"/>';
      // Incline triangle
      centerSvg += '<polygon points="340,480 620,480 620,320" fill="#E2E8F0" stroke="#475569" stroke-width="3"/>';
      
      // Mass block
      centerSvg += '<rect x="460" y="360" width="70" height="50" rx="6" fill="#FFFFFF" stroke="#1E293B" stroke-width="3" transform="rotate(-30 495 385)"/>';
      centerSvg += '<text x="495" y="390" text-anchor="middle" font-size="14" font-weight="900" fill="#1E293B" transform="rotate(-30 495 385)">m</text>';

      // Force Vectors (Gravity, Normal, Friction, Applied)
      centerSvg += '<line x1="495" y1="385" x2="495" y2="475" stroke="#DC2626" stroke-width="4" stroke-linecap="round"/>';
      centerSvg += '<polygon points="495,485 490,470 500,470" fill="#DC2626"/>';
      centerSvg += '<text x="510" y="475" font-size="12" font-weight="800" fill="#DC2626">Fg (mg)</text>';

      centerSvg += '<line x1="495" y1="385" x2="465" y2="310" stroke="#2563EB" stroke-width="4" stroke-linecap="round"/>';
      centerSvg += '<polygon points="460,300 458,315 472,310" fill="#2563EB"/>';
      centerSvg += '<text x="455" y="290" font-size="12" font-weight="800" fill="#2563EB">Fn</text>';

      centerSvg += '<line x1="495" y1="385" x2="420" y2="430" stroke="#16A34A" stroke-width="4" stroke-linecap="round"/>';
      centerSvg += '<text x="400" y="445" font-size="12" font-weight="800" fill="#16A34A">Friction</text>';

    } else if (/reaction|reactant|product|catalyst|enthalpy|activation energy|exothermic|endothermic|titrat|acid|base|ph /i.test(textForMatch)) {
      domain = 'chemistry';
      subTitle = 'CHEMICAL REACTION KINETICS & ENERGETICS';
      colors = ['#0891B2', '#7C3AED', '#EA580C', '#16A34A', '#2563EB', '#D97706'];

      // Reaction Coordinate Potential Energy Profile
      centerSvg += '<rect x="290" y="190" width="380" height="340" rx="20" fill="#F0FDFA" stroke="#0D9488" stroke-width="3.5"/>';
      centerSvg += '<line x1="330" y1="480" x2="630" y2="480" stroke="#334155" stroke-width="3" stroke-linecap="round"/>';
      centerSvg += '<line x1="330" y1="480" x2="330" y2="230" stroke="#334155" stroke-width="3" stroke-linecap="round"/>';
      centerSvg += '<text x="325" y="235" text-anchor="end" font-size="13" font-weight="800" fill="#334155">Energy (E)</text>';
      centerSvg += '<text x="630" y="505" text-anchor="end" font-size="13" font-weight="800" fill="#334155">Progress</text>';

      // Potential Energy Activation Curve
      centerSvg += '<path d="M340 400 H400 C430 400, 450 250, 480 250 C510 250, 530 450, 560 450 H620" fill="none" stroke="#0D9488" stroke-width="4.5" stroke-linecap="round"/>';
      
      // Transition state peak & Ea arrow
      centerSvg += '<circle cx="480" cy="250" r="9" fill="#EA580C" stroke="#FFFFFF" stroke-width="2"/>';
      centerSvg += '<text x="480" y="235" text-anchor="middle" font-size="11" font-weight="900" fill="#EA580C">Transition State [‡]</text>';
      centerSvg += '<line x1="400" y1="400" x2="480" y2="400" stroke="#64748B" stroke-dasharray="4 4"/>';
      centerSvg += '<line x1="480" y1="250" x2="480" y2="400" stroke="#7C3AED" stroke-width="2.5"/>';
      centerSvg += '<text x="495" y="325" font-size="12" font-weight="900" fill="#7C3AED">Ea</text>';

      // Enthalpy drop
      centerSvg += '<line x1="560" y1="400" x2="620" y2="400" stroke="#64748B" stroke-dasharray="4 4"/>';
      centerSvg += '<line x1="590" y1="400" x2="590" y2="450" stroke="#DC2626" stroke-width="2.5"/>';
      centerSvg += '<text x="600" y="430" font-size="12" font-weight="900" fill="#DC2626">ΔH</text>';

    } else if (/cell|organelle|membrane|mitochondri|nucleus|ribosome|cytoplasm|enzyme|protein/i.test(textForMatch)) {
      domain = 'biology_cell';
      subTitle = 'CELLULAR ULTRASTRUCTURE & ORGANELLES';
      colors = ['#10B981', '#06B6D4', '#8B5CF6', '#F59E0B', '#14B8A6', '#6366F1'];
      
      // Detailed biological cell cross-section
      centerSvg += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="180" ry="175" fill="#ECFDF5" stroke="#10B981" stroke-width="6" stroke-dasharray="8 4"/>';
      centerSvg += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="164" ry="160" fill="#F0FDF4" stroke="#059669" stroke-width="4"/>';
      // Mitochondria capsules
      centerSvg += '<rect x="360" y="360" width="70" height="36" rx="18" fill="#FDE68A" stroke="#D97706" stroke-width="3"/>';
      centerSvg += '<path d="M375 378 Q395 365 415 378" fill="none" stroke="#B45309" stroke-width="2.5"/>';
      // Large Nucleus with double membrane & nucleolus
      centerSvg += '<circle cx="' + (cx + 20) + '" cy="' + (cy - 10) + '" r="64" fill="#EDE9FE" stroke="#7C3AED" stroke-width="5"/>';
      centerSvg += '<circle cx="' + (cx + 20) + '" cy="' + (cy - 10) + '" r="42" fill="#DDD6FE" stroke="#8B5CF6" stroke-width="3"/>';
      centerSvg += '<circle cx="' + (cx + 25) + '" cy="' + (cy - 12) + '" r="18" fill="#6D28D9"/>';
      // Ribosomes / micro dots
      centerSvg += '<circle cx="450" cy="440" r="4" fill="#3B82F6"/><circle cx="465" cy="455" r="4" fill="#3B82F6"/><circle cx="485" cy="445" r="4" fill="#3B82F6"/>';
      centerSvg += '<circle cx="390" cy="260" r="4" fill="#3B82F6"/><circle cx="410" cy="250" r="4" fill="#3B82F6"/>';

    } else if (/war|battle|wwii|wwi|treaty|empire|revolution|military|army|soviet|cold war|allies|axis/i.test(textForMatch)) {
      domain = 'history';
      subTitle = 'HISTORICAL THEATRE & STRATEGIC CHRONOLOGY';
      colors = ['#DC2626', '#D97706', '#2563EB', '#475569', '#7C3AED', '#059669'];
      
      centerSvg += '<rect x="300" y="190" width="360" height="340" rx="20" fill="#FEF2F2" stroke="#DC2626" stroke-width="4"/>';
      // Strategic grid lines
      centerSvg += '<line x1="300" y1="270" x2="660" y2="270" stroke="#FCA5A5" stroke-width="1.5" stroke-dasharray="6 4"/>';
      centerSvg += '<line x1="300" y1="360" x2="660" y2="360" stroke="#FCA5A5" stroke-width="1.5" stroke-dasharray="6 4"/>';
      centerSvg += '<line x1="300" y1="450" x2="660" y2="450" stroke="#FCA5A5" stroke-width="1.5" stroke-dasharray="6 4"/>';
      centerSvg += '<line x1="420" y1="190" x2="420" y2="530" stroke="#FCA5A5" stroke-width="1.5" stroke-dasharray="6 4"/>';
      centerSvg += '<line x1="540" y1="190" x2="540" y2="530" stroke="#FCA5A5" stroke-width="1.5" stroke-dasharray="6 4"/>';
      // Front lines & tactical arrows
      centerSvg += '<path d="M340 480 Q430 380 470 330 Q510 280 620 230" fill="none" stroke="#DC2626" stroke-width="5" stroke-linecap="round"/>';
      centerSvg += '<path d="M350 490 Q440 390 480 340 Q520 290 630 240" fill="none" stroke="#2563EB" stroke-width="3" stroke-dasharray="8 6"/>';
      // Central Shield
      centerSvg += '<path d="M480 290 L525 315 V370 Q525 410 480 435 Q435 410 435 370 V315 Z" fill="#FFFFFF" stroke="#991B1B" stroke-width="4"/>';
      centerSvg += '<circle cx="480" cy="360" r="14" fill="#DC2626"/>';

    } else if (/code|comput|algorithm|network|database|ai|neural|data|server|api|software|cpu|cloud/i.test(textForMatch)) {
      domain = 'tech';
      subTitle = 'DISTRIBUTED SYSTEM ARCHITECTURE';
      colors = ['#8B5CF6', '#06B6D4', '#10B981', '#3B82F6', '#F59E0B', '#6366F1'];
      
      centerSvg += '<rect x="300" y="190" width="360" height="340" rx="20" fill="#F5F3FF" stroke="#7C3AED" stroke-width="4"/>';
      centerSvg += '<path d="M340 260 H420 V340 H460" fill="none" stroke="#8B5CF6" stroke-width="3"/>';
      centerSvg += '<path d="M340 460 H420 V380 H460" fill="none" stroke="#8B5CF6" stroke-width="3"/>';
      centerSvg += '<path d="M620 260 H540 V340 H500" fill="none" stroke="#06B6D4" stroke-width="3"/>';
      centerSvg += '<path d="M620 460 H540 V380 H500" fill="none" stroke="#06B6D4" stroke-width="3"/>';
      // Central Processing Core Module
      centerSvg += '<rect x="440" y="320" width="80" height="80" rx="14" fill="#7C3AED" stroke="#5B21B6" stroke-width="3"/>';
      centerSvg += '<circle cx="480" cy="360" r="18" fill="#FFFFFF"/>';
      centerSvg += '<text x="480" y="365" text-anchor="middle" font-size="11" font-weight="900" fill="#7C3AED">CORE</text>';
      centerSvg += '<circle cx="340" cy="260" r="12" fill="#10B981"/><circle cx="340" cy="460" r="12" fill="#10B981"/>';
      centerSvg += '<circle cx="620" cy="260" r="12" fill="#06B6D4"/><circle cx="620" cy="460" r="12" fill="#06B6D4"/>';

    } else {
      // General Dynamic Multi-Node Analytic Synthesis Matrix
      domain = 'general_framework';
      subTitle = 'CONCEPTUAL ARCHITECTURE & SYSTEM MATRIX';
      colors = ['#4F46E5', '#06B6D4', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6'];

      // Hexagonal multi-hub synthesis core
      centerSvg += '<polygon points="480,210 610,285 610,435 480,510 350,435 350,285" fill="#EEF2FF" stroke="#4F46E5" stroke-width="3.5" stroke-dasharray="8 6"/>';
      centerSvg += '<polygon points="480,250 570,300 570,420 480,470 390,420 390,300" fill="#E0E7FF" stroke="#6366F1" stroke-width="2.5"/>';

      // Internal connection web
      centerSvg += '<line x1="480" y1="250" x2="480" y2="470" stroke="#818CF8" stroke-width="2"/>';
      centerSvg += '<line x1="390" y1="300" x2="570" y2="420" stroke="#818CF8" stroke-width="2"/>';
      centerSvg += '<line x1="390" y1="420" x2="570" y2="300" stroke="#818CF8" stroke-width="2"/>';

      // Central Hub
      centerSvg += '<circle cx="480" cy="360" r="38" fill="#FFFFFF" stroke="#4F46E5" stroke-width="4"/>';
      centerSvg += '<circle cx="480" cy="360" r="22" fill="#4F46E5"/>';
      centerSvg += '<circle cx="480" cy="360" r="10" fill="#EEF2FF"/>';

      // Satellite Nodes
      centerSvg += '<circle cx="480" cy="210" r="14" fill="#06B6D4" stroke="#FFFFFF" stroke-width="2.5"/>';
      centerSvg += '<circle cx="610" cy="285" r="14" fill="#10B981" stroke="#FFFFFF" stroke-width="2.5"/>';
      centerSvg += '<circle cx="610" cy="435" r="14" fill="#F59E0B" stroke="#FFFFFF" stroke-width="2.5"/>';
      centerSvg += '<circle cx="480" cy="510" r="14" fill="#EC4899" stroke="#FFFFFF" stroke-width="2.5"/>';
      centerSvg += '<circle cx="350" cy="435" r="14" fill="#8B5CF6" stroke="#FFFFFF" stroke-width="2.5"/>';
      centerSvg += '<circle cx="350" cy="285" r="14" fill="#3B82F6" stroke="#FFFFFF" stroke-width="2.5"/>';
    }

    let svg = '';
    svg += '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">';
    svg += '<rect width="100%" height="100%" fill="' + bgFill + '"/>';
    
    // Header Title & Contextual Category Subtitle
    svg += '<text x="' + cx + '" y="56" text-anchor="middle" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif" font-size="26" font-weight="800" fill="#09090B" letter-spacing="-0.02em">' + escXml(rawTitle) + '</text>';
    svg += '<text x="' + cx + '" y="84" text-anchor="middle" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif" font-size="13" font-weight="700" fill="#64748B" text-transform="uppercase" letter-spacing="0.08em">' + escXml(subTitle) + '</text>';

    // Render central theme
    svg += centerSvg;

    // Draw Left & Right Callout Cards with Angled Pointers
    function drawSide(items, isLeft) {
      const n = Math.max(items.length, 1);
      items.forEach(function (lab, i) {
        const y = 175 + i * Math.min(130, 410 / n);
        const color = colors[i % colors.length];
        const cardX = isLeft ? 40 : 710;
        const cardW = 210;
        const cardH = 58;
        const pinX = isLeft ? (cardX + cardW) : cardX;
        const targetX = isLeft ? (cx - 150 + (i * 15)) : (cx + 150 - (i * 15));
        const targetY = cy - 60 + (i * 45);

        // Connection Line & Glowing Anchor
        svg += '<path d="M' + pinX + ' ' + (y + cardH / 2) + ' Q' + ((pinX + targetX) / 2) + ' ' + (y + cardH / 2) + ' ' + targetX + ' ' + targetY + '" fill="none" stroke="' + color + '" stroke-width="3" stroke-linecap="round"/>';
        svg += '<circle cx="' + targetX + '" cy="' + targetY + '" r="7" fill="' + color + '" stroke="#FFFFFF" stroke-width="2"/>';

        // Callout Card Box
        svg += '<rect x="' + cardX + '" y="' + y + '" width="' + cardW + '" height="' + cardH + '" rx="14" fill="#FFFFFF" stroke="' + color + '" stroke-width="2.5" filter="drop-shadow(0 4px 12px rgba(0,0,0,0.06))"/>';
        
        // Color Accent Indicator Pill
        svg += '<circle cx="' + (isLeft ? (cardX + 22) : (cardX + 22)) + '" cy="' + (y + cardH / 2) + '" r="6" fill="' + color + '"/>';
        
        // Label Text
        const textX = cardX + 38;
        svg += '<text x="' + textX + '" y="' + (y + cardH / 2 + 6) + '" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif" font-size="16" font-weight="700" fill="#18181B">' + escXml(String(lab).slice(0, 24)) + '</text>';
      });
    }

    drawSide(left, true);
    drawSide(right, false);

    svg += '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function resolveTopicImage(query, done, meta) {
    meta = meta || {};
    const q = String(query || '').trim();
    const title = meta.title || q || 'Diagram';
    const labels = parseDiagramLabels(meta.caption, q, title);
    if (!q && !labels.length) { done(null); return; }

    const cacheKey = (q + '|' + labels.join(',')).toLowerCase();
    const cached = readImgCache()[cacheKey];
    if (cached) {
      done(cached);
      return;
    }

    // 1. Generate high-quality topic-tailored vector diagram immediately so reader has instant crisp visual
    const vectorUrl = buildLabeledDiagramSvg(title, labels);
    writeImgCache(cacheKey, vectorUrl);
    done(vectorUrl);

    // 2. Optionally attempt background AI infographic generation via NVIDIA FLUX for rich pictorial diagrams
    try {
      const email = localStorage.getItem('NOURA_EMAIL') || '';
      const prompt = `Educational visual diagram of "${title}". Topic: ${q}. Components shown: ${labels.join(', ')}. Clean vector illustration, educational infographic style, high contrast, white background, textbook diagram.`;
      fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Noura-Email': email },
        body: JSON.stringify({ prompt: prompt, source: 'lesson' })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data && data.image_url && data.image_url.startsWith('data:image/png')) {
          writeImgCache(cacheKey, data.image_url);
        }
      })
      .catch(function() {});
    } catch(e) {}
  }

  function readImgCache() {
    try {
      const v = JSON.parse(localStorage.getItem(IMG_CACHE_KEY) || '{}');
      return (v && typeof v === 'object') ? v : {};
    } catch (e) { return {}; }
  }

  function writeImgCache(query, url) {
    try {
      const cache = readImgCache();
      cache[String(query || '').toLowerCase()] = url;
      const keys = Object.keys(cache);
      if (keys.length > 80) keys.slice(0, keys.length - 80).forEach(function (k) { delete cache[k]; });
      localStorage.setItem(IMG_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {}
  }

  function prefetchImage(src) {
    if (!src) return;
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
    } catch (e) {}
  }

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function p(text, withTerms) {
    const node = el('p', 'lf-p');
    if (!withTerms || !withTerms.length) {
      node.textContent = text;
      return node;
    }
    let rest = String(text || '');
    const parts = [];
    const metas = (withTerms || []).map(termMeta).filter(function (m) { return m && m.term; });
    // Apply longest terms first so nested matches don't break
    metas.sort(function (a, b) { return b.term.length - a.term.length; });
    metas.forEach(function (m) {
      const term = m.term;
      if (!term || rest.indexOf(term) === -1) return;
      const idx = rest.indexOf(term);
      if (idx > 0) parts.push(document.createTextNode(rest.slice(0, idx)));
      const b = el('span', 'lf-term');
      b.setAttribute('tabindex', '0');
      b.appendChild(document.createTextNode(term));
      if (m.def) {
        const tip = el('span', 'lf-term-tip');
        tip.textContent = m.def;
        b.appendChild(tip);
      }
      parts.push(b);
      rest = rest.slice(idx + term.length);
    });
    if (rest) parts.push(document.createTextNode(rest));
    if (parts.length) parts.forEach(function (x) { node.appendChild(x); });
    else node.textContent = text;
    return node;
  }

  function bulletList(items) {
    const ul = el('ul');
    (items || []).forEach(function (item) {
      const li = el('li');
      li.innerHTML = '<span></span><span>' + esc(item) + '</span>';
      ul.appendChild(li);
    });
    return ul;
  }

  const LessonFlow = {
    root: null,
    shell: null,
    main: null,
    footer: null,
    step: 0,
    visited: new Set([0]),
    expandedCards: new Set(),
    feedback: null,
    autoPractice: false,
    dark: true, // always dark
    data: null,
    callbacks: {},
    topicEmoji: '📖',

    totalSteps: function () {
      const steps = (this.data && this.data.flow && this.data.flow.steps) || [];
      return Math.max(steps.length, 1);
    },

    mount: function (container) {
      this.root = typeof container === 'string' ? document.getElementById(container) : container;
      if (!this.root) return;
      this.root.innerHTML = '';
      this.shell = el('div', 'lf-shell');
      this.root.appendChild(this.shell);
      this.renderChrome();
    },

    renderChrome: function () {
      const self = this;
      this.shell.innerHTML = '';

      const header = el('header', 'lf-header');
      const closeBtn = el('button', 'lf-close');
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      closeBtn.addEventListener('click', function () { self.close(); });

      const progress = el('div', 'lf-progress');
      progress.id = 'lfProgress';
      header.appendChild(closeBtn);
      header.appendChild(progress);


      this.main = el('main', 'lf-main');
      this.main.innerHTML = '<div class="lf-main-inner" id="lfMainInner"></div>';

      this.footer = el('footer', 'lf-footer');
      this.footer.innerHTML = '<div class="lf-footer-inner" id="lfFooterInner"></div>';

      this.shell.appendChild(header);
      this.shell.appendChild(this.main);
      this.shell.appendChild(this.footer);
      this.renderProgress();
      this.renderStep();
      this.renderFooter();
    },

    renderProgress: function () {
      const wrap = document.getElementById('lfProgress');
      if (!wrap) return;
      wrap.innerHTML = '';
      const self = this;
      const total = this.totalSteps();
      for (let i = 0; i < total; i++) {
        const dot = el('button', 'lf-dot' + (i === this.step ? ' active' : '') + (this.visited.has(i) ? ' visited' : ''));
        dot.type = 'button';
        dot.setAttribute('aria-label', 'Step ' + (i + 1));
        (function (idx) {
          dot.addEventListener('click', function () {
            if (self.visited.has(idx) || idx <= self.step) {
              self.step = idx;
              self.renderProgress();
              self.renderStep();
              self.renderFooter();
              if (self.main) self.main.scrollTop = 0;
            }
          });
        })(i);
        wrap.appendChild(dot);
      }
    },

    renderFooter: function () {
      const wrap = document.getElementById('lfFooterInner');
      if (!wrap) return;
      const total = this.totalSteps();
      const s = this.getStep(this.step);
      const kind = s.kind || this.inferKind(this.step, total);

      wrap.className = 'lf-footer-inner' + (this.step === 0 ? ' wide' : '');
      wrap.innerHTML = '';
      const self = this;

      if (kind === 'gate') return;

      if (this.step === 0) {
        const next = el('button', 'lf-btn lf-btn-next');
        next.textContent = 'Next';
        next.addEventListener('click', function () { self.goNext(); });
        wrap.appendChild(next);
        return;
      }

      const back = el('button', 'lf-btn lf-btn-back');
      back.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Back';
      back.disabled = this.step <= 0;
      back.addEventListener('click', function () { self.goBack(); });

      const next = el('button', 'lf-btn lf-btn-next');
      const isLast = this.step >= total - 1;
      next.textContent = kind === 'reflection' || isLast ? 'Continue' : 'Next';
      next.addEventListener('click', function () {
        if (isLast) self.finish(false);
        else self.goNext();
      });

      wrap.appendChild(back);
      wrap.appendChild(next);
    },

    goNext: function () {
      if (this.step >= this.totalSteps() - 1) {
        this.finish(false);
        return;
      }
      this.step++;
      this.visited.add(this.step);
      this.renderProgress();
      this.renderStep();
      this.renderFooter();
      if (this.main) this.main.scrollTop = 0;
      if (this.callbacks.onStep) this.callbacks.onStep(this.step);
    },

    goBack: function () {
      if (this.step <= 0) return;
      this.step--;
      this.renderProgress();
      this.renderStep();
      this.renderFooter();
      if (this.main) this.main.scrollTop = 0;
    },

    getStep: function (i) {
      const steps = (this.data && this.data.flow && this.data.flow.steps) || [];
      return steps[i] || {};
    },

    inferKind: function (i, total) {
      const s = this.getStep(i);
      if (s.kind) return s.kind;
      const map = ['hook', 'baseline', 'context', 'compare', 'turning', 'consequence', 'synthesis', 'reflection', 'gate'];
      if (total <= map.length) return map[i] || 'content';
      return 'content';
    },

    renderStep: function () {
      const inner = document.getElementById('lfMainInner');
      if (!inner) return;
      inner.innerHTML = '';
      const s = this.getStep(this.step);
      const kind = this.inferKind(this.step, this.totalSteps());
      const wrap = el('div');

      switch (kind) {
        case 'hook': wrap.appendChild(this.renderHook(s)); break;
        case 'baseline':
        case 'content': wrap.appendChild(this.renderBaseline(s)); break;
        case 'context': wrap.appendChild(this.renderContext(s)); break;
        case 'compare': wrap.appendChild(this.renderCompare(s)); break;
        case 'turning': wrap.appendChild(this.renderTurning(s)); break;
        case 'consequence': wrap.appendChild(this.renderConsequence(s)); break;
        case 'synthesis': wrap.appendChild(this.renderSynthesis(s)); break;
        case 'table': wrap.appendChild(this.renderTable(s)); break;
        case 'reflection': wrap.appendChild(this.renderReflection(s)); break;
        case 'gate': wrap.appendChild(this.renderGate(s)); break;
        default: wrap.appendChild(this.renderBaseline(s)); break;
      }

      inner.appendChild(wrap);
    },

    renderHook: function (s) {
      const box = el('div', 'lf-hook');
      box.innerHTML = '<h1>' + esc(s.question || s.title || 'What makes this topic worth understanding?') + '</h1>' +
        '<p class="lf-subtitle">' + esc(s.subtitle || (this.data && this.data.title) || 'Your lesson') + '</p>';
      return box;
    },

    renderBaseline: function (s) {
      const box = el('div');
      box.appendChild(el('h1', 'lf-title', esc(s.title || 'The Starting Point')));
      const paras = s.paragraphs || (s.body ? [s.body] : []);
      const terms = s.highlightTerms || [];
      paras.forEach(function (txt) {
        box.appendChild(p(txt, terms.length ? terms : null));
      });

      const q = s.imageQuery || s.title || (this.data && this.data.title) || '';
      const captionText = s.imageCaption || s.imageAlt || s.title || '';
      const imgWrap = el('div', 'lf-image-wrap is-loading');
      const skeleton = el('div', 'lf-image-skeleton');
      skeleton.setAttribute('aria-hidden', 'true');
      imgWrap.appendChild(skeleton);
      box.appendChild(imgWrap);
      if (captionText) {
        box.appendChild(el('div', 'lf-image-caption', esc(captionText)));
      }

      function showImg(src, alt) {
        if (!src) {
          imgWrap.classList.remove('is-loading');
          imgWrap.classList.add('is-empty');
          return;
        }
        const img = document.createElement('img');
        img.alt = alt || captionText || '';
        img.decoding = 'async';
        img.loading = 'eager';
        img.onload = function () {
          imgWrap.classList.remove('is-loading');
          img.classList.add('is-ready');
          skeleton.style.display = 'none';
        };
        img.onerror = function () {
          img.remove();
          imgWrap.classList.remove('is-loading');
          imgWrap.classList.add('is-empty');
          skeleton.textContent = 'Diagram unavailable';
          skeleton.classList.add('lf-image-fallback-msg');
        };
        img.src = src;
        imgWrap.insertBefore(img, skeleton);
      }

      // Always use crisp SVG diagrams with real text labels (never AI image gibberish)
      if (s.imageUrl && String(s.imageUrl).indexOf('data:image/svg') === 0) {
        showImg(s.imageUrl, captionText || q);
      } else {
        resolveTopicImage(q, function (src) {
          if (src) s.imageUrl = src;
          showImg(src, captionText || q);
        }, { title: s.title || q, caption: captionText });
      }

      if (s.closing) box.appendChild(p(s.closing));
      if (s.callout) {
        const c = el('div', 'lf-callout');
        c.innerHTML = '<h3>' + esc(s.callout.title) + '</h3><p>' + esc(s.callout.body) + '</p>';
        box.appendChild(c);
      }
      return box;
    },

    renderContext: function (s) {
      const box = el('div');
      box.appendChild(el('h1', 'lf-title', esc(s.title || 'Setting the Scene')));
      const terms = s.highlightTerms || [];
      (s.paragraphs || []).forEach(function (txt) {
        box.appendChild(p(txt, terms.length ? terms : null));
      });
      if (s.callout) {
        const c = el('div', 'lf-callout');
        c.innerHTML = '<h3>' + esc(s.callout.title) + '</h3><p>' + esc(s.callout.body) + '</p>';
        box.appendChild(c);
      }
      return box;
    },

    renderCompare: function (s) {
      const box = el('div');
      box.appendChild(el('h1', 'lf-title', esc(s.title || 'Common Picture vs Reality')));
      (s.paragraphs || []).forEach(function (txt) { box.appendChild(p(txt)); });
      if (s.compareLabel) box.appendChild(el('div', 'lf-compare-label', esc(s.compareLabel)));
      const grid = el('div', 'lf-compare-grid');
      const oldCard = el('div', 'lf-compare-card');
      oldCard.appendChild(el('h4', null, esc(s.oldLabel || 'The old picture')));
      oldCard.appendChild(bulletList(s.oldPicture || []));
      const evCard = el('div', 'lf-compare-card');
      evCard.appendChild(el('h4', null, esc(s.evidenceLabel || 'What evidence shows')));
      evCard.appendChild(bulletList(s.evidence || []));
      grid.appendChild(oldCard);
      grid.appendChild(evCard);
      box.appendChild(grid);
      if (s.insight) box.appendChild(p(s.insight));
      return box;
    },

    renderTurning: function (s) {
      const box = el('div');
      box.appendChild(el('h1', 'lf-title', esc(s.title || 'The Turning Point')));
      (s.paragraphs || []).forEach(function (txt) { box.appendChild(p(txt)); });
      const card = el('div', 'lf-timeline-card');
      const head = el('div', 'lf-timeline-head');
      head.innerHTML = '<div class="lf-kicker">' + esc(s.timelineLabel || 'How the change unfolded') + '</div>' +
        '<div class="lf-badge">' + esc(String((s.milestones || []).length)) + ' Steps</div>';
      card.appendChild(head);
      const list = el('div', 'lf-milestones');
      (s.milestones || []).forEach(function (m, idx) {
        const item = el('div', 'lf-milestone');
        item.innerHTML = '<div class="lf-milestone-num">' + esc(String(m.num || idx + 1)) + '</div>' +
          '<h4>' + esc(m.title) + '</h4><p>' + esc(m.description) + '</p>';
        list.appendChild(item);
      });
      card.appendChild(list);
      box.appendChild(card);
      return box;
    },

    renderConsequence: function (s) {
      const box = el('div');
      box.appendChild(el('h1', 'lf-title', esc(s.title || 'What Changed After')));
      const terms = s.highlightTerms || [];
      (s.paragraphs || []).forEach(function (txt) {
        box.appendChild(p(txt, terms.length ? terms : null));
      });

      // Vertical flow diagram (artifact layout): top pill → two middles → purple outcome
      const flow = s.flow || {};
      const events = (s.events || []).slice(0, 4);
      function lab(x) {
        if (!x) return '';
        if (typeof x === 'string') return shortChartLabel(x);
        return shortChartLabel(x.label || x.title || x.text || '');
      }
      const top = lab(flow.top) || lab(events[0]) || 'Starting point';
      const midA = lab(flow.middle && flow.middle[0]) || lab(events[1]) || 'Path A';
      const midB = lab(flow.middle && flow.middle[1]) || lab(events[2]) || 'Path B';
      const bottom = lab(flow.bottom) || lab(events[3]) || 'Outcome';
      const flowTitle = flow.title || s.chartTitle || s.title || 'How it connects';

      const card = el('div', 'lf-flow');
      card.appendChild(el('div', 'lf-flow-title', esc(flowTitle)));

      const stack = el('div', 'lf-flow-stack');
      stack.appendChild(el('div', 'lf-flow-pill', esc(top)));
      stack.appendChild(el('div', 'lf-flow-arrow', '<span aria-hidden="true">↓</span>'));

      const mid = el('div', 'lf-flow-mid');
      mid.appendChild(el('div', 'lf-flow-box lf-flow-box-mid', esc(midA)));
      mid.appendChild(el('div', 'lf-flow-box lf-flow-box-mid', esc(midB)));
      stack.appendChild(mid);

      stack.appendChild(el('div', 'lf-flow-arrow', '<span aria-hidden="true">↓</span>'));
      stack.appendChild(el('div', 'lf-flow-box lf-flow-box-out', esc(bottom)));

      card.appendChild(stack);
      box.appendChild(card);
      return box;
    },

    renderSynthesis: function (s) {
      const box = el('div');
      box.appendChild(el('h1', 'lf-title', esc(s.title || 'Why This Matters')));
      (s.paragraphs || []).forEach(function (txt) { box.appendChild(p(txt)); });
      const cmp = s.comparison || {};
      const card = el('div', 'lf-timeline-card');
      card.style.textAlign = 'center';
      const kick = el('div', 'lf-kicker', esc(String(cmp.label || 'Two phases of our story').toUpperCase()));
      kick.style.textAlign = 'center';
      card.appendChild(kick);
      const grid = el('div', 'lf-synth-grid');
      ['before', 'after'].forEach(function (side) {
        const col = el('div', 'lf-synth-col');
        const phase = cmp[side] || {};
        col.innerHTML = '<div class="lf-synth-phase">' + esc(phase.title || (side === 'before' ? 'Before' : 'After')) + '</div>';
        const items = el('div', 'lf-synth-items');
        (phase.items || []).slice(0, 3).forEach(function (item) {
          let text = String(item || '').trim();
          const words = text.split(/\s+/);
          if (words.length > 8) text = words.slice(0, 8).join(' ');
          items.appendChild(el('div', 'lf-synth-item', esc(text)));
        });
        col.appendChild(items);
        grid.appendChild(col);
      });
      card.appendChild(grid);
      if (cmp.shared) {
        const shared = el('div', 'lf-synth-shared');
        const sharedText = String(cmp.shared);
        if (/^both have[:\s]/i.test(sharedText)) {
          shared.innerHTML = '<strong>Both have</strong><span>' + esc(sharedText.replace(/^both have[:\s]*/i, '')) + '</span>';
        } else {
          shared.innerHTML = '<strong>Both have</strong><span>' + esc(sharedText) + '</span>';
        }
        card.appendChild(shared);
      }
      box.appendChild(card);
      return box;
    },

    renderTable: function (s) {
      const box = el('div');
      box.appendChild(el('h1', 'lf-title', esc(s.title || 'Key Facts')));
      const terms = s.highlightTerms || [];
      (s.paragraphs || []).forEach(function (txt, idx) {
        box.appendChild(p(txt, idx === 0 ? terms : null));
      });
      const table = s.table || {};
      let headers = table.headers || [];
      let rows = table.rows || [];
      // Normalize object-row format {choice, shaping, why} from the design artifact
      if ((!rows.length) && Array.isArray(table.items)) {
        rows = table.items.map(function (it) {
          return [it.choice || it.col1 || '', it.shaping || it.col2 || '', it.why || it.col3 || ''];
        });
      }
      if (!headers.length && rows.length) {
        headers = ['Choice', 'Shaping experience', 'Why it is rational'];
      }
      if (headers.length && rows.length) {
        const wrap = el('div', 'lf-table-wrap');
        // Prefer the clean 3-column grid from the design when we have 3 columns
        if (headers.length === 3) {
          const head = el('div', 'lf-table-head');
          headers.forEach(function (h) {
            head.appendChild(el('span', null, esc(h)));
          });
          wrap.appendChild(head);
          rows.forEach(function (row) {
            const cells = Array.isArray(row) ? row : [row.choice || row.col1, row.shaping || row.col2, row.why || row.col3];
            const rowEl = el('div', 'lf-table-row');
            for (let i = 0; i < 3; i++) {
              rowEl.appendChild(el('span', null, esc(cells[i] != null ? cells[i] : '')));
            }
            wrap.appendChild(rowEl);
          });
        } else {
          let html = '<table class="lf-table"><thead><tr>';
          headers.forEach(function (h) { html += '<th>' + esc(h) + '</th>'; });
          html += '</tr></thead><tbody>';
          rows.forEach(function (row) {
            html += '<tr>';
            (Array.isArray(row) ? row : [row]).forEach(function (cell) {
              html += '<td>' + esc(cell) + '</td>';
            });
            html += '</tr>';
          });
          html += '</tbody></table>';
          wrap.innerHTML = html;
        }
        box.appendChild(wrap);
      }
      if (s.callout) {
        const c = el('div', 'lf-callout');
        c.innerHTML = '<h3>' + esc(s.callout.title) + '</h3><p>' + esc(s.callout.body) + '</p>';
        box.appendChild(c);
      }
      return box;
    },

    renderReflection: function (s) {
      const self = this;
      const box = el('div');
      box.appendChild(el('h1', 'lf-title center', esc(s.title || 'Review your notes, magic insights and knowledge cards')));

      box.appendChild(el('div', 'lf-section-label', 'My Notes'));
      box.appendChild(el('div', 'lf-dashed-box', 'No notes yet — highlight text to add one'));

      box.appendChild(el('div', 'lf-section-label', 'Magic Insights ✨'));
      box.appendChild(el('div', 'lf-dashed-box', 'Insights will appear as you learn'));

      box.appendChild(el('div', 'lf-section-label', 'Knowledge Cards'));
      const kcards = el('div', 'lf-kcards');
      (s.knowledgeCards || []).forEach(function (card, idx) {
        const item = el('div', 'lf-kcard' + (self.expandedCards.has(idx) ? ' open' : ''));
        const btn = el('button', 'lf-kcard-btn');
        btn.innerHTML = '<span>' + esc(card.title) + '</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>';
        btn.addEventListener('click', function () {
          if (self.expandedCards.has(idx)) self.expandedCards.delete(idx);
          else self.expandedCards.add(idx);
          self.renderStep();
        });
        item.appendChild(btn);
        item.appendChild(el('div', 'lf-kcard-body', esc(card.body)));
        kcards.appendChild(item);
      });
      box.appendChild(kcards);

      const fb = el('div', 'lf-feedback');
      fb.appendChild(el('div', 'lf-feedback-label', 'How was this lesson?'));
      const btns = el('div', 'lf-feedback-btns');
      ['👍', '👎'].forEach(function (emoji, idx) {
        const b = el('button');
        b.textContent = emoji;
        if ((idx === 0 && self.feedback === 'up') || (idx === 1 && self.feedback === 'down')) b.classList.add('active');
        b.addEventListener('click', function () {
          self.feedback = idx === 0 ? 'up' : 'down';
          self.renderStep();
        });
        btns.appendChild(b);
      });
      fb.appendChild(btns);
      box.appendChild(fb);
      return box;
    },

    renderGate: function (s) {
      const self = this;
      const box = el('div', 'lf-gate');
      box.innerHTML = '<div class="lf-gate-icon" aria-hidden="true"><div style="font-size:64px;line-height:1">📝</div></div>' +
        '<h1>' + esc(s.title || 'Want to finish a quick practice?') + '</h1>' +
        '<p>' + esc(s.body || 'A short practice can help make what you learned stick.') + '</p>';

      const toggleRow = el('div', 'lf-toggle-row');
      toggleRow.innerHTML = '<span>Apply to all future lessons in this course</span>';
      const toggle = el('button', 'lf-toggle' + (this.autoPractice ? ' on' : ''));
      toggle.type = 'button';
      toggle.innerHTML = '<span class="lf-toggle-knob"></span>';
      toggle.addEventListener('click', function () {
        self.autoPractice = !self.autoPractice;
        try { localStorage.setItem(PRACTICE_KEY, self.autoPractice ? '1' : '0'); } catch (e) {}
        self.renderStep();
      });
      toggleRow.appendChild(toggle);
      box.appendChild(toggleRow);

      const actions = el('div', 'lf-gate-actions');
      const notNow = el('button', 'lf-btn lf-btn-back');
      notNow.style.flex = '1';
      notNow.textContent = 'Not Now';
      notNow.addEventListener('click', function () { self.finish(false); });

      const start = el('button', 'lf-btn lf-btn-next');
      start.textContent = 'Start Practice';
      start.addEventListener('click', function () { self.finish(true); });

      actions.appendChild(notNow);
      actions.appendChild(start);
      box.appendChild(actions);
      return box;
    },

    prefetchImages: function () {
      const steps = (this.data && this.data.flow && this.data.flow.steps) || [];
      steps.forEach(function (s) {
        if (!s || (s.kind !== 'baseline' && s.kind !== 'content')) return;
        const q = s.imageQuery || s.title || '';
        const caption = s.imageCaption || s.imageAlt || s.title || '';
        resolveTopicImage(q, function (src) {
          if (!src) return;
          s.imageUrl = src;
          prefetchImage(src);
        }, { title: s.title || q, caption: caption });
      });
    },

    open: function (data, opts) {
      opts = opts || {};
      this.data = data;
      this.callbacks = {
        onClose: opts.onClose,
        onComplete: opts.onComplete,
        onPractice: opts.onPractice,
        onStep: opts.onStep
      };
      this.topicEmoji = opts.emoji || '📖';
      this.step = (typeof opts.startStep === 'number' && opts.startStep >= 0) ? opts.startStep : 0;
      this.visited = new Set();
      for (let i = 0; i <= this.step; i++) this.visited.add(i);
      this.expandedCards = new Set();
      this.feedback = null;
      try { this.autoPractice = localStorage.getItem(PRACTICE_KEY) === '1'; } catch (e) { this.autoPractice = false; }

      // Warm every diagram while the intro page is open so later pages appear ready
      this.prefetchImages();

      const player = this.root.parentElement;
      player.classList.add('open');
      player.setAttribute('data-theme', 'dark');
      document.body.classList.add('lf-active');
      this.renderChrome();
      if (this.main) this.main.scrollTop = 0;
    },

    close: function () {
      const player = this.root.parentElement;
      player.classList.remove('open');
      document.body.classList.remove('lf-active');
      if (this.callbacks.onClose) this.callbacks.onClose();
    },

    finish: function (startPractice) {
      document.body.classList.remove('lf-active');
      this.root.parentElement.classList.remove('open');
      if (this.callbacks.onComplete) this.callbacks.onComplete({ feedback: this.feedback, startPractice: startPractice, autoPractice: this.autoPractice });
      if (startPractice && this.callbacks.onPractice) this.callbacks.onPractice();
    }
  };

  global.LessonFlow = LessonFlow;
})(window);
