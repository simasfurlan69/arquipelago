/**
 * Dialogues.js
 * Conversas com Bruno (Ferreiro) e Mestre Heitor (Guilda).
 * ctx: { q (Quests), story, inv, shopBruno(), dayNight, player, giveOrDrop }
 */
import { ITEMS } from '../game/Items.js';
import { REP_LEVELS, repLevel } from '../game/Quests.js';

// ---------------------------------------------------------------------------
// Utilidades compartilhadas: menus de missões
// ---------------------------------------------------------------------------
function questNodes(giver, prefix, voice) {
  const nodes = {};
  nodes[`${prefix}_jobs`] = {
    text: (c) => {
      const off = c.q.offers(giver), act = c.q.active(giver).filter((q) => !q.auto), lk = c.q.locked(giver);
      if (!off.length && !act.length) return lk.length ? voice.locked : voice.none;
      return off.length ? voice.list : voice.busy;
    },
    options: (c) => [
      ...c.q.offers(giver).map((q) => ({ label: `📜 ${q.title}`, action: () => { c.sel = q.id; return `${prefix}_offer`; } })),
      ...c.q.active(giver).filter((q) => !q.auto).map((q) => ({ label: `${c.q.isReady(q) ? '✔' : '…'} ${q.title} — ${c.q.objText(q)}`, action: () => { c.sel = q.id; return c.q.isReady(q) ? `${prefix}_turnin` : `${prefix}_progress`; } })),
      ...c.q.locked(giver).slice(0, 2).map((q) => ({ label: `🔒 ${q.title} (precisa de ${q.minRep} de reputação · você tem ${c.q.rep[giver]})`, style: 'dim', action: () => `${prefix}_jobs` })),
      { label: 'Voltar.', next: `${prefix}_menu` },
    ],
  };
  nodes[`${prefix}_offer`] = {
    text: (c) => { const q = c.q.def(c.sel); return [q.desc, `Recompensa: ${c.q.rewardText(q)}.`]; },
    options: (c) => [
      { label: 'Aceito.', action: () => { c.q.accept(c.sel); return `${prefix}_accepted`; } },
      { label: 'Agora não.', next: `${prefix}_jobs` },
    ],
  };
  nodes[`${prefix}_accepted`] = { text: () => voice.accepted, options: [{ label: 'Mais algum trabalho?', next: `${prefix}_jobs` }, { label: 'Até logo.', next: '__end' }] };
  nodes[`${prefix}_progress`] = {
    text: (c) => { const q = c.q.def(c.sel); return `${voice.progress} (${c.q.objText(q)})`; },
    options: [{ label: 'Voltar.', next: `${prefix}_jobs` }],
  };
  nodes[`${prefix}_turnin`] = {
    text: (c) => { const q = c.q.def(c.sel); c.q.turnIn(c.sel); return [voice.thanks, `Você recebeu: ${c.q.rewardText(q)}.`]; },
    options: [{ label: 'Mais algum trabalho?', next: `${prefix}_jobs` }, { label: 'Até logo.', next: '__end' }],
  };
  return nodes;
}

const repName = (c, who) => REP_LEVELS[repLevel(c.q.rep[who])].name;

// =============================================================================
// BRUNO, O FERREIRO
// =============================================================================
export const BRUNO = {
  start: 'b_greet',
  nodes: {
    b_greet: {
      text: (c) => {
        const met = c.memo.bruno_met; c.memo.bruno_met = true;
        const ready = c.q.ready('bruno').length;
        if (!met) return ['*CLANG* *CLANG* — Hm? Ah, um rosto novo. Desculpe a fuligem, a forja não perdoa quem tem pressa.', 'Sou Bruno. Ferreiro desta vila desde antes de você aprender a andar. Se precisa de aço, de conselho ou de trabalho honesto, veio ao lugar certo.'];
        if (ready) return 'Ora, ora! Esses olhos dizem que você trouxe o que eu pedi. Vamos ver isso!';
        const b = c.q.bossesDown;
        if (b.has('nimbra') && !c.memo.bruno_nimbra) { c.memo.bruno_nimbra = true; return ['Você trouxe o Machado de Gelo? Deixe-me ver... *passa o dedo na lâmina* Frio como a primeira geada.', 'Isso não foi forjado por mãos humanas. Nenhuma forja minha consegue nem riscar esse gelo. Cuide bem dele.']; }
        if (b.has('grakk') && !c.memo.bruno_legend) { c.memo.bruno_legend = true; return ['Uma arma lendária! Os guardiões guardavam essas peças desde a fundação do arquipélago.', 'Elas não gastam e nunca quebram. E cada uma tem um poder: encha sua Fúria lutando e solte com F. Eu não saberia nem por onde começar a forjar uma dessas.']; }
        if (b.has('ignar') && !c.memo.bruno_ignar) { c.memo.bruno_ignar = true; return ['...Então é verdade. Ignar caiu.', 'Ele foi meu mestre, sabe? Me ensinou a ouvir o metal cantar. A Maré Negra o transformou num monstro, mas você o libertou. Obrigado.']; }
        if (b.has('korrak') && !c.memo.bruno_korrak) { c.memo.bruno_korrak = true; return 'Korrak, o golem! Dizem que a armadura dele era feita da mesma pedra destes alicerces. Se trouxer fragmentos, guardo como relíquia.'; }
        if (b.has('grakk') && !c.memo.bruno_grakk) { c.memo.bruno_grakk = true; return 'A vila inteira ouviu o rugido do Javali de Ferro calando-se. Belo trabalho! Aquelas presas dariam ótimas empunhaduras...'; }
        if (c.night) return 'Ainda acordado? Eu também. O metal esfria melhor com a brisa da noite... e os mortos não gostam do calor da forja.';
        return ['Bem-vindo de volta! O que vai ser hoje?', 'De volta à forja, hein? Diga.', 'Hm-hm. Fala, aventureiro.'][Math.floor(Math.random() * 3)];
      },
      options: [{ label: 'Continuar', next: 'b_menu' }],
    },
    b_menu: {
      text: (c) => `(Reputação com Bruno: ${repName(c, 'bruno')})  O que você precisa?`,
      options: (c) => [
        { label: c.q.ready('bruno').length ? '✔ Entregar encomendas' : 'Tem trabalho para mim?', next: 'b_jobs' },
        { label: '⚒ Ver seus equipamentos', action: () => { c.openBrunoShop(); return '__end'; } },
        { label: 'Dicas de forja', next: 'b_tips' },
        { label: 'Quem é você?', next: 'b_who', if: () => !c.memo.bruno_who },
        { label: 'Como era a ilha antes da Maré Negra?', next: 'b_lore' },
        { label: 'Fale sobre os guardiões.', next: 'b_guardians' },
        { label: 'Até logo.', next: 'b_bye' },
      ],
    },
    b_who: {
      text: (c) => { c.memo.bruno_who = true; return [
        'Eu? Fui ferreiro da Guarda Real, quando ainda havia um rei nestas ilhas. Forjei espadas para capitães e ferraduras para cavalos do palácio.',
        'Quando a Coroa caiu, vim para cá com minha bigorna e um saco de carvão. Isso foi há vinte anos.',
        'Meu mestre, Ignar, me ensinou que o ferro tem memória. Ele lembra de cada golpe. Por isso nunca bata no metal com raiva.',
      ]; },
      options: [{ label: 'E o que aconteceu com Ignar?', next: 'b_ignar' }, { label: 'Voltar.', next: 'b_menu' }],
    },
    b_ignar: {
      text: (c) => c.q.bossesDown.has('ignar')
        ? 'Você o libertou. Agora ele descansa. A brasa do coração dele... se a encontrou, traga para mim.'
        : ['Ignar foi para a Ilha da Forja Negra estudar o fogo que nunca apaga. Voltou diferente... os olhos dele ardiam.', 'Depois disso, só ouvimos o martelo dele à noite, vindo do mar. Se um dia for até lá... cuidado. E, se puder, liberte-o.'],
      options: [{ label: 'Voltar.', next: 'b_menu' }],
    },
    b_lore: {
      text: [
        'Antes da Maré Negra, estas águas eram as mais movimentadas do mundo. Navios de especiarias, ouro, música no porto toda noite.',
        'Sete guardiões protegiam as ilhas, cada um com um Selo da Maré. Fui eu, ainda aprendiz, quem poliu os selos para a cerimônia de juramento.',
        'Então veio Varkhul, o Rei Morto. Com uma maré negra que subiu num único entardecer, ele corrompeu seis guardiões. Desde então, os mortos andam quando o sol se põe.',
      ],
      options: [{ label: 'Como derroto Varkhul?', next: 'b_varkhul' }, { label: 'Voltar.', next: 'b_menu' }],
    },
    b_varkhul: {
      text: 'Ninguém derrota Varkhul sem os seis selos. A Mestre Heitor sabe mais — mas sei que você vai precisar de aço melhor que pedra. Traga minério e eu te ajudo a chegar lá.',
      options: [{ label: 'Voltar.', next: 'b_menu' }],
    },
    b_guardians: {
      text: (c) => {
        const n = c.q.bossesDown.size;
        if (!n) return ['Grakk era o guardião das florestas — virou um javali de ferro que derruba árvores com as presas.', 'Korrak, o golem, nem a espada arranha. Só uma boa picareta racha aquela pedra. Lembre-se disso.'];
        return `Você já libertou ${n} ${n > 1 ? 'guardiões' : 'guardião'}. Cada selo que volta para casa deixa a maré um pouco mais fraca. Continue!`;
      },
      options: [{ label: 'Voltar.', next: 'b_menu' }],
    },
    b_tips: {
      text: [
        'Ouça bem: pedra quebra fácil, mas é o começo. Ouro corta rápido e brilha, mas cansa no minério duro. Metal dura uma vida — 300 golpes antes de pedir reparo.',
        'Carvão é o coração do refino: 1 minério + 1 carvão viram 1 barra, aqui na minha forja.',
        'Os veios escuros são carvão, os alaranjados são ferro, e o ouro só aparece no alto das montanhas. Picareta de pedra não arranha ferro; de ouro já dá.',
        'E não esqueça: uma barra do mesmo material restaura as ferramentas. Ferramenta quebrada não se conserta!',
      ],
      options: [{ label: 'Obrigado, mestre.', next: 'b_menu' }],
    },
    b_bye: {
      text: (c) => (c.night ? 'Cuidado lá fora. Leve uma lâmina afiada.' : 'Volte quando precisar de aço!'),
      options: [{ label: '(Sair)', next: '__end' }],
    },
    ...questNodes('bruno', 'b', {
      list: 'Trabalho não falta. Escolha um:',
      busy: 'Você já tem tarefas comigo. Como estão indo?',
      none: 'Por hoje é só. Volte amanhã — sempre aparece encomenda nova.',
      locked: 'Ainda não confio o bastante para te dar os pedidos grandes. Mostre serviço com o que já te dei.',
      accepted: 'Fechado. Aperto de mão de ferreiro vale contrato!',
      progress: 'Ainda não está completo. Volte quando tiver tudo.',
      thanks: '*pesa nas mãos* Hm! Material de primeira. Aqui está o combinado — você merece.',
    }),
  },
};

// =============================================================================
// MESTRA HELENA, GUILDA DOS NAVEGANTES
// =============================================================================
export const HELENA = {
  start: 'h_greet',
  nodes: {
    h_greet: {
      text: (c) => {
        const met = c.memo.helena_met; c.memo.helena_met = true;
        const bounties = c.q.bounties().length;
        if (!met) return ['*fecha o livro de contratos* Um viajante! Faz tempo que alguém novo pisa neste salão.', 'Sou Heitor, Mestre da Guilda dos Navegantes. Aqui registramos cada contrato, cada rota, cada nome que vale ser lembrado.', 'E pelo jeito... o seu ainda não está escrito. Vamos mudar isso?'];
        if (bounties) return 'Notícias correm rápido pelo porto. A Guilda honra suas recompensas — venha receber o que é seu.';
        if (c.q.ready('helena').length) return 'Vejo que você cumpriu um contrato. Excelente! Vamos registrar.';
        if (c.story.step === 'done') return 'O herói do arquipélago em pessoa! Os bardos já cantam sua história no porto.';
        if (c.q.bossesDown.has('nimbra') && !c.memo.helena_nimbra) { c.memo.helena_nimbra = true; return ['Olhe pela janela... o céu sobre a Ilha das Chuvas está ABERTO. Faz cem anos que ninguém via aquilo.', 'Nimbra está livre. Só resta Varkhul, na Ilha da Coroa. A Guilda inteira reza por você.']; }
        if (c.story.currentBoss?.def.id === 'nimbra' && !c.memo.helena_rain) { c.memo.helena_rain = true; return ['Seis selos! Mas há um sétimo guardião que Varkhul escondeu: Nimbra, a Abominação da Tempestade — uma criatura de carapaça e olhos roxos que rasteja e SALTA.', 'A ilha dela vive sob chuva eterna e os Tubarões-Rei guardam a costa. Leve comida, flechas... e não fique parado quando os círculos azuis aparecerem.']; }
        return c.night ? 'Trabalhando até tarde? A Guilda nunca fecha enquanto houver mortos lá fora.' : 'Bem-vindo de volta ao Salão da Guilda.';
      },
      options: [{ label: 'Continuar', next: 'h_menu' }],
    },
    h_menu: {
      text: (c) => `(Reputação com a Guilda: ${repName(c, 'helena')})  Em que posso ajudar?`,
      options: (c) => [
        { label: c.q.bounties().length ? `💰 Receber recompensas de guardiões (${c.q.bounties().length})` : null, next: 'h_bounty', if: () => c.q.bounties().length > 0 },
        { label: c.q.ready('helena').filter((q) => !q.auto).length ? '✔ Entregar contratos' : 'Ver o quadro de contratos', next: 'h_jobs' },
        { label: '⚜ A missão principal', next: 'h_main' },
        { label: 'O que é a Guilda?', next: 'h_guild' },
        { label: 'Dicas de navegação e combate', next: 'h_tips' },
        { label: 'Minha reputação', next: 'h_rep' },
        { label: 'Até logo.', next: 'h_bye' },
      ],
    },
    h_main: {
      text: (c) => c.story.talkHelena(),
      options: [{ label: 'Voltar.', next: 'h_menu' }, { label: 'Até logo.', next: '__end' }],
    },
    h_bounty: {
      text: (c) => {
        const list = c.q.bounties();
        const lines = list.map((q) => { const t = c.q.rewardText(q); c.q.turnIn(q.id); return `${q.title}: ${t}`; });
        return ['*abre um baú de ferro* Pela libertação dos guardiões, a Guilda paga o prometido:', ...lines];
      },
      options: [{ label: 'Obrigado, Mestre.', next: 'h_menu' }],
    },
    h_guild: {
      text: [
        'A Guilda dos Navegantes nasceu quando as primeiras rotas foram traçadas entre estas ilhas. Mapeamos correntes, recifes, ventos... e perigos.',
        'Depois da Maré Negra, nossos navios pararam de voltar. Agora somos poucos — mas ainda pagamos quem mantém estas águas seguras.',
        'Cumpra contratos e seu nome sobe no livro. Os mais honrados recebem trabalhos melhores... e melhor pagos.',
      ],
      options: [{ label: 'Quero um contrato.', next: 'h_jobs' }, { label: 'Voltar.', next: 'h_menu' }],
    },
    h_tips: {
      text: [
        'Perto da costa você está seguro: piratas e navios fantasmas só atacam em mar aberto, longe das ilhas.',
        'Os canhões disparam pelo lado para onde você olha. Segure Shift para disparar os dois bordos. A linha fica vermelha quando vai acertar.',
        'Em terra, a esquiva (Ctrl) salva vidas. Trave a mira em um inimigo com Q.',
        'E coma bem: uma refeição pesada antes de enfrentar um guardião faz toda a diferença.',
      ],
      options: [{ label: 'Voltar.', next: 'h_menu' }],
    },
    h_rep: {
      text: (c) => {
        const lv = repLevel(c.q.rep.helena), next = REP_LEVELS[lv + 1];
        const titles = c.q.titles.length ? ` Títulos: ${c.q.titles.join(', ')}.` : '';
        return `Seu nome está no livro como "${REP_LEVELS[lv].name}" (${c.q.rep.helena} pontos).${next ? ` Faltam ${next.at - c.q.rep.helena} para "${next.name}".` : ' Não há honra maior.'}${titles}`;
      },
      options: [{ label: 'Voltar.', next: 'h_menu' }],
    },
    h_bye: {
      text: 'Que a maré esteja a seu favor.',
      options: [{ label: '(Sair)', next: '__end' }],
    },
    ...questNodes('helena', 'h', {
      list: '*abre o livro de contratos* Estes estão disponíveis para você:',
      busy: 'Você tem contratos em andamento. Como estão?',
      none: 'Nenhum contrato novo agora. Volte amanhã — o livro sempre se enche.',
      locked: 'Os contratos maiores exigem mais reputação. Cumpra os que já tem.',
      accepted: 'Registrado no livro da Guilda. Boa sorte.',
      progress: 'O contrato ainda não está cumprido.',
      thanks: '*carimba o livro* Contrato cumprido. A Guilda paga o que promete.',
    }),
  },
};

export const FACES = { bruno: { face: '⚒', color: '#6a3a1a' }, helena: { face: '📜', color: '#2e4a36' } };
export { ITEMS };
