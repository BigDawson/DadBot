import { Firehose } from "@skyware/firehose";
import { BskyAgent } from '@atproto/api';
import * as dotenv from 'dotenv';
// import * as process from 'process';

import { writeFile, unlink } from 'fs/promises';
import { existsSync as legacyExistsSync } from 'fs';
import { join } from 'path';

const lockFilePath = join(process.cwd(), 'script.lock');

// Function to clean up the lock file
async function cleanup() {
  if (legacyExistsSync(lockFilePath)) {
    await unlink(lockFilePath);
    console.log('Lock file removed.');
  }
  process.exit();
}

// Check if the lock file already exists
if (legacyExistsSync(lockFilePath)) {
  console.log('Another instance is already running.');
  process.exit(1);
}

// Create the lock file
try {
  await writeFile(lockFilePath, process.pid.toString());
  console.log('Lock file created.');
} catch (err) {
  console.error('Failed to create lock file:', err);
  process.exit(1);
}

// Setup exit handlers to remove the lock file
process.on('exit', cleanup);
process.on('SIGINT', cleanup); // Handle Ctrl+C
process.on('SIGTERM', cleanup); // Handle termination signals

dotenv.config();


// Create a Bluesky Agent 
const agent = new BskyAgent({
    service: 'https://bsky.social',
})


async function getFollowerDIDs() {
    
    await agent.login({ identifier: process.env.BLUESKY_USERNAME, password: process.env.BLUESKY_PASSWORD})

    let profile = await agent.getProfile({actor: process.env.BLUESKY_USERNAME});

    let followerCount = profile.followersCount;

    var followerDIDToPath = {}
    var followerPathToDID = {}
    let cursor = '';
    while(true)
    {
        let response = await agent.getFollowers({actor: process.env.BLUESKY_USERNAME, limit: 100, cursor: cursor});
        for (var i in response.data.followers)
        {
            let followedBy = response.data.followers[i].viewer.followedBy
            let path = followedBy.split("/")[3] + "/" + followedBy.split("/")[4]
            let did = response.data.followers[i].did;
            followerDIDToPath[did] = path;
            followerPathToDID[path] = did;
        }

        if (!response.data.cursor)
        {
            break;
        }
        cursor = response.data.cursor
    }

    return {DIDToPath: followerDIDToPath, PathToDID: followerPathToDID}
    
    
}

let followerInfo = await getFollowerDIDs()
let DIDToPath = followerInfo.DIDToPath;
let PathToDID = followerInfo.PathToDID;

function getDadJoke(str)
{
    let regex = /(?<=I am|Im|I'm) +([^.,;\n\r]*[^.,; \n\r]+)/i

    let result = regex.exec(str);
    if (!result || !result[1])
    {
        return false;
    }
    if (result[1])
    {
        return "Hello " + result[1] + ", I'm Dad!"
    }

    return false;
}


const firehose = new Firehose();
firehose.on("commit", async (commit) => {
    var did = commit.repo;

    for (const op of commit.ops) {

        // Check if it's a new follow
        // Add follower/path from structure
        if (op.action == "create" && op.hasOwnProperty('record') && op.record['$type'] == 'app.bsky.graph.follow' && op.record.subject == process.env.BLUESKY_DID)
        {
            console.log("Gained a new follower: " + did);
            console.log("Path: " + op.path);

            DIDToPath[did] = op.path;
            PathToDID[op.path] = did;
        }

        // Check if we lost a follower
        // Remove follower/path from structure
        if (op.action == 'delete' && op.hasOwnProperty('path') && PathToDID.hasOwnProperty(op.path))
        {
            console.log("Lost a follower: " + did);
            delete DIDToPath[did];
            delete PathToDID[op.path];
        }

        // Handle post
        // Only reply if we follow them
        if (op.hasOwnProperty('record') && op.record['$type'] == 'app.bsky.feed.post' && op.record.text && DIDToPath.hasOwnProperty(did))
        {
            let postReplyingToUri = "at://" + did + "/" + op.path;
            let postReplyingToCid = op.cid;
            let threadRootPostUri = "at://" + did + "/" + op.path;
            let threadRootPostCid = op.cid;

            // Get the Dad joke if it applies
            var joke = getDadJoke(op.record.text);
            if (joke)
            {
                console.log(joke)

                // Handle case where we're replying
                if (op.record.hasOwnProperty("reply"))
                {
                    threadRootPostUri = op.record.reply.root.uri;
                    threadRootPostCid = op.record.reply.root.cid;
                }
                await agent.login({ identifier: process.env.BLUESKY_USERNAME, password: process.env.BLUESKY_PASSWORD})
                await agent.post(
                    {
                        text: joke,
                        reply: {
                        root: {
                          uri: threadRootPostUri,
                          cid: threadRootPostCid,
                        },
                        parent: {
                          uri: postReplyingToUri,
                          cid: postReplyingToCid,
                        }
                    },
                });   
            }
        }
        else
        {
            // console.log(op);
            // if (op.hasOwnProperty('record'))
            // {
            //     console.log(op.record);
            // }
        }
    }
});


// Hopefully unintended errors
firehose.on("error", async function(error){
    console.log("Error");
    console.log(error);
})

// Hopefully unintended errors
firehose.on("websocketError", async function(error){
    console.log("Error");
    console.log(error);
})

firehose.start();


