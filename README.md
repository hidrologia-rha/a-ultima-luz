# A Última Luz — Crônicas da Noite Eterna

Beat 'em up de fantasia sombria em **estilo 16 bits**, feito só com HTML5, CSS3 e JavaScript puro.
Tudo (sprites, cenário, fonte, sons) é gerado pelo código: não há imagens, fontes ou áudios externos,
nem dependências, servidor ou internet.

## Como jogar no Windows

1. Abra a pasta `dark-fantasy-beat-em-up`.
2. Dê dois cliques em `index.html` (abre no navegador padrão via `file://`).
3. Use uma versão recente do Chrome, Edge ou Firefox.

Não é preciso instalar nada.

## Controles

| Tecla | Ação |
|---|---|
| W / S ou ↑ / ↓ | Mover em profundidade |
| A / D ou ← / → | Mover na horizontal |
| J | Ataque leve (combo de até 3) |
| K | Ataque pesado (também finaliza o combo) |
| L | Esquiva (invulnerável no início) |
| I | Aparar |
| O | Rito de Sangue (custa 50 de sangue) |
| Enter | Confirmar / pular a narração |
| Esc | Pausar / voltar |
| R | Reiniciar após vitória ou derrota |
| M | Liga/desliga o som |
| 1 / 2 / 3 | Escolher melhoria na tela de nível |

Os menus funcionam só com teclado (setas ou W/S + Enter) e também com o mouse.

## Objetivo

Sobreviver a três ondas nas Ruínas da Catedral Negra e derrotar o **Cavaleiro da Noite Eterna**.

1. Onda I: Soldados Corrompidos.
2. Onda II: soldados e Criaturas Sanguíneas.
3. Onda III: o Carrasco com escolta.
4. Encontro Final: o Cavaleiro (duas fases).

## Mecânicas

- **Combo:** aperte J durante o golpe para encadear até 3 cortes; K no meio do combo finaliza.
- **Profundidade:** golpes só acertam quem está na mesma faixa do chão.
- **Telegráfico:** brilho branco na ponta da arma e área pontilhada no chão antes do golpe inimigo.
- **Aparo perfeito:** I logo antes do impacto. Anula o dano, atordoa o inimigo, dá 20 de sangue e o próximo golpe causa +50%.
- **Aparo tardio:** bloqueia 75% do dano, sem atordoar.
- **Carmesim (!):** golpes marcados em vermelho não podem ser aparados; esquive.
- **Atordoados** recebem +35% de dano. O chefe tem postura: golpes pesados acumulam até quebrá-la.
- **Sangue (0–100):** ganho ao acertar, aparar, esquivar no último instante, matar e a cada 10 golpes de combo.
- **Rito de Sangue (O):** golpe em área ao redor do Guardião; o chefe resiste a parte do dano.
- **Progressão:** XP sobe o nível; entre ondas você escolhe uma melhoria:
  - Lâmina Afiada: +20% de dano (máx. 3).
  - Vigor Sombrio: +25 de vida, +1 de defesa e cura total (máx. 3).
  - Disciplina de Sangue: +0,04 s de aparo perfeito e +25% de sangue (máx. 2).
- **Chefe:** fase I com golpe horizontal, investida e impacto no chão (carmesim). Abaixo de 50% de vida
  ele ruge (fica imune, com aura azul visível), acelera, ganha a sequência tripla com golpe final carmesim
  e o impacto passa a soltar uma onda de choque que só se atravessa esquivando.

## Visual 16 bits

- A cena é desenhada num canvas de **320×180** e ampliada sem suavização (`image-rendering: pixelated`),
  em escala inteira sempre que isso não desperdiça muito espaço da janela.
- O cenário é pixel art pré-renderizada em camadas com parallax (céu, montanhas, nave da catedral, piso,
  primeiro plano), com gradientes em pontilhado e transparências em faixas no lugar de degradês suaves.
- Os personagens são animados por um esqueleto (poses e quadros-chave) e convertidos a cada quadro em
  sprite: alfa binário, cores presas à paleta do personagem e contorno de 1 pixel. Acertos piscam em branco.
- Textos do jogo e dos menus usam uma fonte bitmap 5×7 própria, com acentos do português.

## Estrutura

```text
dark-fantasy-beat-em-up/
├── index.html   telas (menus em DOM, acessíveis por teclado e leitor de tela)
├── style.css    janelas no estilo RPG de 16 bits, cursor de seleção, escala
├── game.js      todo o jogo
├── README.md
└── assets/      vazio; reservado para recursos opcionais futuros
```

Principais partes de `game.js`: `Game` (loop e fluxo), `InputManager`, `Player`, `Enemy`, `Boss`,
`CombatSystem` (dano, defesa, aparo), `EffectSystem` (partículas em pool), `AudioManager` (Web Audio),
`HUD` (desenhado no canvas), `Renderer` (cenário e sprites), `SaveManager`, `GameStateManager`
(MENU, CONTROLS, PLAYING, PAUSED, VICTORY, GAME_OVER), além de `WaveDirector`, `Progression`
e a fonte bitmap `PF`. Os números de balanceamento ficam no topo: `PLAYER_BASE`, `PLAYER_ATTACKS`,
`ENEMY_TYPES`, `BOSS_DEF`, `BOSS_ATTACKS`, `UPGRADES`, `PROGRESSION`, `WAVES`.

## Salvamento

Fica no `localStorage` do navegador (chave `ultima-luz.save.v1`): recorde, melhor tempo, vitórias,
volume, som ligado/desligado, ambiente sonoro e o ponto de retorno (início da última onda alcançada,
com nível e melhorias). "Continuar" retoma desse ponto; "Tentar de novo" também.
Os dados são validados ao carregar: salvamento corrompido é ignorado e o jogo abre normalmente.
Sem `localStorage` (modo privado restrito, por exemplo) o jogo funciona, só não guarda nada.
"Apagar progresso" pede confirmação e mantém as preferências de áudio.
Nada pessoal é armazenado e não há nenhuma chamada de rede.

## Problemas comuns

- **Sem som:** o navegador só libera áudio após a primeira tecla ou clique. Confira também a tecla M e o volume.
- **Teclas não respondem:** clique na página para dar foco à janela.
- **Imagem pequena com bordas pretas:** o jogo prefere escala inteira para manter os pixels nítidos.
  Maximize a janela ou use tela cheia (F11).
- **Progresso não salva via `file://`:** alguns navegadores isolam o `localStorage` de arquivos locais.
  O jogo continua funcionando; só o salvamento é perdido ao fechar.

## Limitações conhecidas

- Apenas teclado; não há suporte a controle (gamepad).
- Uma arena, três tipos de inimigo e um chefe.
- Os sprites vêm de um esqueleto animado e não de pixel art desenhada à mão quadro a quadro.
- Sem trilha musical; há um ambiente sonoro grave opcional.

## Como adicionar conteúdo

- **Inimigo novo:** acrescente uma entrada em `ENEMY_TYPES`, crie a aparência em `LOOKS` (com o tamanho
  do `sprite`) e as poses em `POSES` (`idle`, `wind`, `hit`, `hurt`, `stagger`, `dead`).
- **Onda nova:** acrescente em `WAVES` uma lista `spawns` de `[tipo, atraso]` e o `maxAlive`.
- **Ataque do chefe:** acrescente em `BOSS_ATTACKS` (tipo `melee`, `charge` ou `slam`, com seus `strikes`)
  e inclua o nome em `Boss.chooseAttack`.
- **Melhoria nova:** acrescente em `UPGRADES`/`UPGRADE_IDS`, aplique o efeito em `computeStats`
  e crie o cartão correspondente em `index.html`.
- **Som novo:** acrescente uma receita em `SFX` e chame `game.audio.play('nome')`.
