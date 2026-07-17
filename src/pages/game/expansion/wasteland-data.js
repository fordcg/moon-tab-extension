(function(root) {
  'use strict';

  root.WastelandData = Object.freeze({
    unlock: {
      population: 16,
      requiredBuilding: 'trading post',
      requiredStore: 'compass'
    },
    factionOrder: ['embers', 'iron', 'trail'],
    factions: {
      embers: {
        name: '守火人',
        summary: '他们把陌生人带到火边，也把最后一口粮分成两半。',
        route: 'hearth',
        reconciliation: {
          text: '灰旗插在两边中间。谁也没有原谅谁，但最后一段路可以继续。',
          action: '举起灰旗，送上一次赔礼',
          cost: { wood: 300, cloth: 20, 'cured meat': 30, medicine: 2 },
          notification: '灰旗被收下。旧账仍在，只是不再挡路。'
        },
        quests: [
          {
            title: '林边的三个人',
            text: ['林边站着三个人。彼此隔得很远。', '守火人先问村里还有没有空床。'],
            choices: [
              {
                id: 'share-pot',
                text: '分出一口锅',
                cost: { 'cured meat': 15, medicine: 1 },
                reputation: { embers: 12, trail: -2 },
                notification: '火边多了几张陌生的脸。'
              },
              {
                id: 'ask-for-work',
                text: '只收能干活的人',
                cost: { wood: 100 },
                reputation: { embers: 8, iron: 3, trail: -4 },
                notification: '守火人点头，却没有笑。'
              }
            ]
          },
          {
            title: '冻河营地',
            text: ['河床冻得像一条白路。', '对岸的营火已经两天没有冒烟。'],
            choices: [
              {
                id: 'carry-medicine',
                text: '带药过去',
                cost: { medicine: 3, 'cured meat': 30 },
                reputation: { embers: 18, iron: -3 },
                reward: { cloth: 8 },
                notification: '回来的人少了几个，但都还活着。'
              },
              {
                id: 'mark-safe-bank',
                text: '只标出安全的河岸',
                cost: { torch: 10, bait: 5 },
                reputation: { embers: 12, trail: 5 },
                reward: { fur: 20 },
                notification: '守火人记住了那条绕远的路。'
              }
            ]
          }
        ]
      },
      iron: {
        name: '铁誓商队',
        summary: '他们相信契约、车轮和能被称量的一切。',
        route: 'foundry',
        reconciliation: {
          text: '灰旗插在两边中间。谁也没有原谅谁，但最后一段路可以继续。',
          action: '举起灰旗，送上一次赔礼',
          cost: { wood: 300, cloth: 20, 'cured meat': 30, medicine: 2 },
          notification: '灰旗被收下。旧账仍在，只是不再挡路。'
        },
        quests: [
          {
            title: '断轴的车队',
            text: ['一支车队歪在路旁。', '断轴下面压着半车还没生锈的货。'],
            choices: [
              {
                id: 'repair-axle',
                text: '替他们修好车轴',
                cost: { wood: 100, iron: 20 },
                reputation: { iron: 12, embers: -2 },
                reward: { leather: 5 },
                notification: '车轮重新压过冻硬的泥。'
              },
              {
                id: 'buy-cargo',
                text: '买下剩余的货',
                cost: { fur: 150 },
                reputation: { iron: 8, trail: 4 },
                reward: { iron: 12, coal: 10 },
                notification: '没有人再提那根断轴。'
              }
            ]
          },
          {
            title: '旧炉债',
            text: ['旧冶炼炉里还有余热。', '铁誓商队说，欠下的钢总得有人来还。'],
            choices: [
              {
                id: 'honour-debt',
                text: '把钢放在炉边',
                cost: { steel: 15, coal: 30 },
                reputation: { iron: 18, trail: -3 },
                reward: { bullets: 12 },
                notification: '一枚旧印章留在钢锭上。'
              },
              {
                id: 'open-ledger',
                text: '摊开账本重算',
                cost: { sulphur: 20, teeth: 50 },
                reputation: { iron: 12, embers: 5 },
                reward: { steel: 6 },
                notification: '债少了一半，朋友也少了一半。'
              }
            ]
          }
        ]
      },
      trail: {
        name: '灰径旅团',
        summary: '他们不留城墙，只把每条能活着走完的路画下来。',
        route: 'waystation',
        reconciliation: {
          text: '灰旗插在两边中间。谁也没有原谅谁，但最后一段路可以继续。',
          action: '举起灰旗，送上一次赔礼',
          cost: { wood: 300, cloth: 20, 'cured meat': 30, medicine: 2 },
          notification: '灰旗被收下。旧账仍在，只是不再挡路。'
        },
        quests: [
          {
            title: '无灯的路标',
            text: ['路标被风磨得只剩下一道凹痕。', '灰径旅团说，前面还有人等着这束光。'],
            choices: [
              {
                id: 'relight-markers',
                text: '把路标重新点亮',
                cost: { torch: 10, 'cured meat': 20 },
                reputation: { trail: 12, iron: -2 },
                reward: { scales: 10 },
                notification: '微弱的灯排成一条线。'
              },
              {
                id: 'copy-route',
                text: '只抄下路线',
                cost: { cloth: 15, leather: 10 },
                reputation: { trail: 8, iron: 4, embers: -3 },
                reward: { torch: 5 },
                notification: '地图被折进衣服最里层。'
              }
            ]
          },
          {
            title: '失声地图',
            text: ['带回地图的人一句话也说不出来。', '纸上有三处地方被反复涂黑。'],
            choices: [
              {
                id: 'treat-cartographer',
                text: '先救画地图的人',
                cost: { medicine: 2, cloth: 20 },
                reputation: { trail: 18, embers: 4 },
                reward: { charm: 1 },
                notification: '他醒来后，又添了一条细线。'
              },
              {
                id: 'buy-map',
                text: '只买下地图',
                cost: { scales: 50, teeth: 20 },
                reputation: { trail: 12, iron: 5, embers: -3 },
                reward: { 'cured meat': 15 },
                notification: '那个人被留在了路边。'
              }
            ]
          }
        ]
      }
    },
    routes: {
      hearth: {
        name: '共灶',
        faction: 'embers',
        description: '新搭起的棚屋围着同一堆火。村庄可再容纳十个人。',
        cost: { wood: 300, 'cured meat': 15, medicine: 2 },
        effect: { population: 10, leanYearPopulation: 15 },
        upgrade: {
          name: '长桌',
          description: '棚屋围着长桌又添一圈。村庄总计可再容纳二十人。',
          cost: { wood: 800, 'cured meat': 60, medicine: 5 },
          effect: { population: 20, leanYearPopulation: 25 }
        }
      },
      foundry: {
        name: '铸炉',
        faction: 'iron',
        description: '秤砣和炉火从早响到晚。基础材料、药品和弹药便宜一成。',
        cost: { wood: 300, iron: 40, steel: 10 },
        effect: { tradeMultiplier: 0.9, leanYearTradeMultiplier: 0.85 },
        upgrade: {
          name: '公秤',
          description: '每一笔货都过同一杆秤。基础交易成本降低两成。',
          cost: { wood: 1000, iron: 80, coal: 80, steel: 20 },
          effect: { tradeMultiplier: 0.8, leanYearTradeMultiplier: 0.75 }
        }
      },
      waystation: {
        name: '无灯驿',
        faction: 'trail',
        description: '出发的人总能找到一只空架子。行囊容量增加五。',
        cost: { wood: 300, leather: 20, torch: 15 },
        effect: { capacity: 5, leanYearCapacity: 8 },
        upgrade: {
          name: '远行架',
          description: '空架子一直搭到村口。行囊容量总计增加十。',
          cost: { wood: 800, leather: 80, cloth: 80, torch: 30 },
          effect: { capacity: 10, leanYearCapacity: 13 }
        }
      }
    },
    modifiers: {
      longNight: {
        name: '长夜',
        description: '势力行动耗费增加四分之一，但每次承诺留下更深的印象。'
      },
      leanYear: {
        name: '歉年',
        description: '势力行动耗费增加四成，选定的村庄路线效果更强。'
      },
      wolfSeason: {
        name: '群狼季',
        description: '首领更难现身且更强；若活着升空，会多留下一个荒原印记。'
      }
    },
    bosses: {
      embers: {
        title: '白脊',
        tile: 'Q',
        scene: 'wf-whiteback',
        label: '白脊的巢穴',
        minRadius: 9,
        maxRadius: 12,
        text: ['白色的脊背从枯草间升起。', '它循着村庄的烟，一路找到了这里。'],
        chara: '白脊',
        health: 24,
        damage: 2,
        hit: 0.75,
        cooldown: 1.5,
        ranged: false,
        mechanic: {
          kind: 'charge',
          threshold: 0.5,
          cue: '蓄势',
          warning: '它的伤越深，背脊压得越低。下一次扑击会格外致命。'
        },
        deathMessage: '白色的脊背终于伏进尘土。',
        approaches: [
          { id: 'lure', text: '把它引远', cost: { bait: 5, 'cured meat': 5 }, bypass: true, reputation: { embers: 25, trail: -5 }, loot: {} },
          { id: 'snare', text: '让套索收紧', cost: { bolas: 2 }, health: 16, reputation: { embers: 18, trail: 8 }, loot: { fur: [4, 5], meat: [4, 5], teeth: [2, 3] } },
          { id: 'nest', text: '走进巢穴', cost: {}, reputation: { embers: 20, iron: 4 }, loot: { fur: [8, 13], meat: [8, 13], teeth: [2, 5] } }
        ]
      },
      iron: {
        title: '收路人',
        tile: 'R',
        scene: 'wf-tollkeeper',
        label: '燃烧的旧桥',
        minRadius: 16,
        maxRadius: 19,
        text: ['商路停了三天。', '旧桥上，火光一夜不灭。'],
        chara: '收路人',
        health: 45,
        damage: 5,
        hit: 0.7,
        cooldown: 2,
        ranged: true,
        mechanic: {
          kind: 'toll',
          interval: 10,
          store: 'cured meat',
          amount: 1,
          cue: '夺粮',
          warning: '桥上的战斗拖得越久，带来的口粮越少。'
        },
        deathMessage: '桥上只剩下火星和断绳。',
        approaches: [
          { id: 'medicine', text: '交出药品', cost: { medicine: 3 }, bypass: true, reputation: { iron: 25, embers: -5 }, loot: {} },
          { id: 'release', text: '先放走桥下的人', cost: { medicine: 1, 'cured meat': 5 }, health: 32, reputation: { iron: 18, embers: 8 }, loot: { cloth: [3, 4], medicine: [1, 2] } },
          { id: 'burn', text: '烧掉路障', cost: { torch: 5, sulphur: 5 }, reputation: { iron: 20, trail: 5 }, loot: { cloth: [4, 7], bullets: [3, 6] } }
        ]
      },
      trail: {
        title: '旧哨机',
        tile: 'Z',
        scene: 'wf-sentry',
        label: '转动的白光',
        minRadius: 23,
        maxRadius: 26,
        text: ['废城上方，有一盏灯不肯熄。', '每到夜里，它都转向村庄。'],
        chara: '旧哨机',
        health: 65,
        damage: 6,
        hit: 0.75,
        cooldown: 2.2,
        ranged: true,
        mechanic: {
          kind: 'shield',
          interval: 9,
          cue: '吸能',
          warning: '白光亮起时，下一击会转成它的生命。先用最轻的一击打碎它。'
        },
        deathMessage: '白光在最后一次转动后熄灭。',
        approaches: [
          { id: 'reroute', text: '改写它的巡路线', cost: { 'energy cell': 2, torch: 5 }, health: 48, reputation: { trail: 25, iron: 5 }, loot: { steel: [8, 13], 'energy cell': [2, 4] } },
          { id: 'blind', text: '熄灭沿路的灯', cost: { torch: 12, cloth: 20 }, health: 55, reputation: { trail: 20, embers: 5 }, loot: { steel: [8, 13], 'energy cell': [2, 4] } },
          { id: 'advance', text: '迎着白光前进', cost: { grenade: 2 }, reputation: { trail: 18, iron: 8 }, loot: { steel: [10, 15], 'energy cell': [2, 5] } }
        ]
      }
    },
    randomEvents: [
      {
        id: 'well-line',
        title: '井边的队伍',
        text: ['井边排起一条沉默的队伍。', '三面旗帜都说自己的人先到。'],
        choices: [
          { id: 'share', text: '让孩子先取水', cost: { 'cured meat': 10 }, reputation: { embers: 6, iron: -2 } },
          { id: 'measure', text: '按带来的容器分', cost: { wood: 50 }, reputation: { iron: 6, trail: -2 } },
          { id: 'move', text: '让队伍继续赶路', cost: { torch: 5 }, reputation: { trail: 6, embers: -2 } }
        ]
      },
      {
        id: 'rain-iron',
        title: '雨里的铁',
        text: ['雨水从一块旧铁牌上滴下来。', '牌背刻着三个被刮花的名字。'],
        choices: [
          { id: 'return', text: '把铁牌送还商队', cost: {}, reputation: { iron: 6 }, reward: { iron: 5 } },
          { id: 'grave', text: '把它插在无名坟前', cost: {}, reputation: { embers: 4, trail: 3 } },
          { id: 'melt', text: '扔进炉里', cost: {}, reputation: { iron: -4 }, reward: { steel: 2 } }
        ]
      },
      {
        id: 'night-tracks',
        title: '夜里的脚印',
        text: ['脚印绕着村庄走了一整圈。', '天亮后，没有一枚朝向外面。'],
        choices: [
          { id: 'watch', text: '整夜守着围栏', cost: { 'cured meat': 10 }, reputation: { embers: 4, iron: 2 } },
          { id: 'follow', text: '沿脚印追出去', cost: { torch: 8 }, reputation: { trail: 6, embers: -2 }, reward: { fur: 12 } },
          { id: 'erase', text: '把脚印扫掉', cost: {}, reputation: { trail: -3 } }
        ]
      }
    ],
    endings: {
      concord: {
        name: '三旗同炉',
        lines: ['远处还有火。', '一盏。又一盏。三条路都朝向它。']
      },
      dominion: {
        name: '一旗遮野',
        lines: ['荒原上只剩一种旗帜。', '它铺得很远，远到看不见边。']
      },
      fracture: {
        name: '灰烬分界',
        lines: ['灯在不同方向依次熄灭。', '没有人再提起那张共同的地图。']
      }
    }
  });
})(window);
