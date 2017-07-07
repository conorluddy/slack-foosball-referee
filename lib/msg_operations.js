module.exports = function() {
  const _ = require('lodash');
  const util = require('util');
  const request = require('request');
  const moment = require('moment');
  const msgs = require('../data/messages.json');
  const giphyToken = process.env.SLACK_FOOSBALL_GIPHY_KEY || '';
  const initGameState = {
        currentPlayers: [],
        currentOpenGame: false,
        lastGameTimeStamp: new Date()
      };
  const gameStates = {};
  let anxietyInterval;


  function getRoomGameState(channelId) {
    if (!gameStates[channelId]) {
      gameStates[channelId] = _.clone(initGameState, true);
    }

    return gameStates[channelId];
  }

  function isUserInCurrentGame(userObj, channelId) {
    var gameState = getRoomGameState(channelId);
    return !!_.find(gameState.currentPlayers, function(player) {
      return player === userObj;
    });
  }

  function getRealUserName(rtm, userId) {
    const user = rtm.dataStore.getUserById(userId);
    return user.real_name || user.name
  }

  function getReferenceWithRealName(rtm, userId) {
    const user = rtm.dataStore.getUserById(userId);
    return `<@${userId}|${user.name}>`;
  }

  function getGiphyImage(term = 'foosball') {
    let slackPreviewSizeLimit = 2000000;//If > 2mb, Slack won't show it automatically if it's too big. Strip em :)

    return new Promise((resolve, reject) => {
      if (giphyToken === '') {
        console.log('No Giphy key supplied, no Giphy image returned.');
        reject();
      }
      const url = 'https://api.giphy.com/v1/gifs/search?api_key='+giphyToken+'&q=' + term + '&limit=40';
      request.get({
        url: url,
        json: true
      }, (e, r, results) => {
        if (results.data && results.data.length) {
          let smallEnoughImages = results.data.filter(result => result.images.fixed_height.size < slackPreviewSizeLimit);
          let randomImage = smallEnoughImages[Math.floor(Math.random() * smallEnoughImages.length)]

          //Random param just forces Slack to show images, even if they're repeated
          resolve(randomImage.images.fixed_height.url + '?rand=' + Math.random());
        }
        reject();
      });
    })
  }

  function resetRefTimer(rtm, message, gameState) {
    clearInterval(anxietyInterval);
    const minute = 1000 * 60;
    const minimumDelayInMins = 45;
    const anxietyDelay = Math.floor( minimumDelayInMins * minute + Math.random() * (minimumDelayInMins * minute) );

    console.log(`I'll keep quiet for the next ${anxietyDelay/60*1000} mins`);

    anxietyInterval = setInterval(() => {
      let since = moment(gameState.lastGameTimeStamp).fromNow(true);
      let anxiousMessage = msgs.data[Math.floor(Math.random() * msgs.data.length)];
      anxiousMessage = anxiousMessage.replace('{since}', since);
      anxiousMessage = anxiousMessage.replace('{randomNumber}', Math.random());

      rtm.sendMessage(anxiousMessage, message.channel);
    }, anxietyDelay);
  }

  const commands = {
      newgame : {
        regex: /^(?:--|—)new$/i,
        handler: function (rtm, message) {
          var gameState = getRoomGameState(message.channel);
          if (!gameState.currentOpenGame) {
            gameState.currentPlayers = [];
            gameState.currentOpenGame = true;
            gameState.currentPlayers.push(message.user);
            getGiphyImage('foosball').then((imageUrl) => rtm.sendMessage(`${imageUrl}`, message.channel));
            return rtm.sendMessage(`${getReferenceWithRealName(rtm, message.user)} just started a new game. Message me "--y" to join the game.`, message.channel);
          } else {
            return rtm.sendMessage(`${getReferenceWithRealName(rtm, message.user)}, there is already an open game waiting for ${ 4 - gameState.currentPlayers.length} player(s), use --hard-new command to force a new game. Use --y to join the game.`, message.channel);
          }
        }
      },
      hardnew: {
        regex: /^(?:--|—)hard-new$/i,
        handler: function (rtm, message) {
          var gameState = getRoomGameState(message.channel);
          gameState.currentPlayers = [];
          gameState.currentPlayers.push(message.user);
          gameState.currentOpenGame = true;

          getGiphyImage('nuke').then((image) => rtm.sendMessage(`${image}`, message.channel));
          rtm.sendMessage(`${getReferenceWithRealName(rtm, message.user)} just forced a new game. Message "--y" to join the game.`, message.channel);
        }
      },
      status: {
        regex: /(?:--|—)status$/i,
        handler: function (rtm, message) {
          let gameState = getRoomGameState(message.channel);
          let since = moment(gameState.lastGameTimeStamp).fromNow();

          if (!gameState.currentOpenGame) {
            rtm.sendMessage(`No current game. Last game began ${since}.`, message.channel);
          } else {
            var playersStr = gameState.currentPlayers.map(function(i) {
              return getRealUserName(rtm, i);
            }).join(', ');
            rtm.sendMessage(`Game currently needs ${4 - gameState.currentPlayers.length} more player(s). Players in are: ${playersStr}`, message.channel);
          }
        }
      },
      help: {
        regex: /^(?:--|—)help$/i,
        handler: function (rtm, message) {
          const helpMsg = [];
          helpMsg.push('*Foosball referee, available commands.*');
          helpMsg.push('');
          helpMsg.push('*--new* Begins a new game)');
          helpMsg.push('*--hard-new* Forces new game to reset current state ');
          helpMsg.push('*--y* Add yourself to the open game ');
          helpMsg.push('*--y @user* Adds @user to the open game ');
          helpMsg.push('*--n* Removes yourself from the current game. ');
          helpMsg.push('*--n @user* Removes @user from current game. ');
          helpMsg.push('*--status* Status of current game being organised. ');
          helpMsg.push('*--help* This message! ');
          rtm.sendMessage(helpMsg.join('\n'), message.channel);
        }
      },
      joingame: {
        regex: /(?:--|—)y(?:\s+<@(\w+)>\s*)?$/i,
        handler: function (rtm, message) {
          var gameState = getRoomGameState(message.channel),
              self = this,
              newPlayerMatch = message.text.match(commands.joingame.regex);
              newPlayer = newPlayerMatch && newPlayerMatch[1];
          if (!gameState.currentOpenGame) {
            rtm.sendMessage(`${getReferenceWithRealName(rtm, message.user)} there is no open game, use "--new" to begin a new game.`, message.channel);
          } else {
            if (newPlayer) {   //adding another user to the game.
              if (!isUserInCurrentGame(message.user, message.channel)) {
                rtm.sendMessage(`${getReferenceWithRealName(rtm, message.user)}, you need to be in the game to add or remove players.`, message.channel);
                return;
              } else if (rtm.dataStore.getUserById(newPlayer).is_bot) {
                rtm.sendMessage(`If only bots could play foosball :cry: :glitch_crab:`, message.channel);
                return
              }
            } else if (!newPlayer) {
              newPlayer = message.user;
            }

            if (gameState.currentPlayers.length > 0 && gameState.currentPlayers.filter(function(i) { return i === newPlayer; }).length > 0) {
              rtm.sendMessage(`${getReferenceWithRealName(rtm, newPlayer)} is already signed up for the current game.`, message.channel);
              return;
            }

            if (message.user !== newPlayer) {
              rtm.sendMessage(`${getReferenceWithRealName(rtm, message.user)} has added ${getReferenceWithRealName(rtm, newPlayer)} to the game.`, message.channel);
            }

            gameState.currentPlayers.push(newPlayer);

            if (gameState.currentPlayers.length == 4) {
              var players = gameState.currentPlayers.map(function(i) { return getReferenceWithRealName(rtm, i); });
              players = _.shuffle(players);
              gameState.currentOpenGame = false;
              gameState.lastGameTimeStamp = new Date();
              resetRefTimer(rtm, message, gameState);

              rtm.sendMessage(`:soccer: :bell: Game On!  ${players.slice(0,2).join(' &amp; ')} - Vs - ${players.slice(2,4).join(' &amp; ')}`, message.channel);
              resetRefTimer(rtm, message, gameState);
            } else {
              rtm.sendMessage(`${getReferenceWithRealName(rtm, newPlayer)} you are now in the game. Waiting on ${4 - gameState.currentPlayers.length} player(s).`, message.channel);;
            }
          }
        }
      },
      leavegame: {
        regex: /(?:--|—)n(?:\s+<@(\w+)>\s*)?$/i,
        handler: function (rtm, message) {
          var gameState = getRoomGameState(message.channel),
            playerToRemoveMatch = message.text.match(commands.leavegame.regex);
            playerToRemove = playerToRemoveMatch && playerToRemoveMatch[1];
          if (gameState.currentPlayers.length > 0) {    //check number of players... as we want to allow players leave after a game is setup.
            if (playerToRemove) {
              if (!isUserInCurrentGame(message.user, message.channel)) {
                rtm.sendMessage(`${getReferenceWithRealName(rtm, message.user)}, you need to be in the game to add or remove players.`, message.channel);
                return;
              }
            } else if (!playerToRemove) {
              playerToRemove = message.user;
            }

            if (!gameState.currentPlayers.includes(playerToRemove)) {
              rtm.sendMessage(`${getReferenceWithRealName(rtm, message.user)}, player ${getReferenceWithRealName(rtm, playerToRemove)} is not in the current game.`, message.channel);
            }

            for (var i=0; i < gameState.currentPlayers.length; i++) {
              if (gameState.currentPlayers[i] === playerToRemove) {

                if (playerToRemove !== message.user) {
                  rtm.sendMessage(`${getReferenceWithRealName(rtm, message.user)} just removed ${getReferenceWithRealName(rtm, playerToRemove)} from the game.`, message.channel);
                  //game opened again as player left
                  gameState.currentOpenGame = true;
                }

                gameState.currentPlayers.splice(i,1);
                if (gameState.currentPlayers.length >= 1) {
                  getGiphyImage('chicken').then((imageUrl) => rtm.sendMessage(`${imageUrl}`, message.channel));
                  rtm.sendMessage(`${getReferenceWithRealName(rtm, playerToRemove)} , you are now REMOVED from the game.`, message.channel);
                } else {
                  rtm.sendMessage(`${getReferenceWithRealName(rtm, playerToRemove)} , you are now REMOVED from the game. There are no other players, Game closed.`, message.channel);
                  gameState.currentOpenGame = false;
                }
                break;
              }
            }
          }
        }
      }
    };


  return {
    getGameState: function(channel) {
      return gameStates[channel];
    },
    commands: commands,
    resetGameState: function(channel) {
      //used in unit tests
      gameStates[channel] = _.clone(initGameState, true);
    }
  };
}();
