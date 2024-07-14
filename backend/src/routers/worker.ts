import { PrismaClient } from "@prisma/client";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { TOTAL_DECIMALS, WORKER_JWTSECRET } from "../config";
import { getNextTask } from "../db";
import { workerMiddleware } from "../middleware";
import { createSubmissionInput } from "../types";
import nacl from "tweetnacl";

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";

const router = Router();
const prismaClient = new PrismaClient();
const TOTAL_SUBMISSIONS = 100;
/*
router.post("/signin", async (req, res) => {
    const hardCodedWalletAddress = "0xCDAF44CE32B7f1CdA63d1d2D2b8F47951377A670"
    const existingUser = await prismaClient.worker.findFirst({
        where: {
            address: hardCodedWalletAddress
        }
    })
    if (existingUser) {
        const token = jwt.sign({
            userId: existingUser.id
        }, WORKER_JWTSECRET)
        res.json({
            token
        })
    } else {
        const user = await prismaClient.worker.create({
            data: {
                address: hardCodedWalletAddress,
                pending_amount: 0,
                locked_amount: 0
            }
        })

        const token = jwt.sign({
            userId: user.id
        }, WORKER_JWTSECRET)
        res.json({
            token
        })
    }
});
*/
//eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImlhdCI6MTcxODcyMDQ3OX0.jBZ5clo9VzisrzKsBzyNnaSZCa_lHX3P-pN09W5HXMQ
router.post("/signin", async (req, res) => {
    const { publicKey, signature } = req.body;
    const message = new TextEncoder().encode("Sign into mechanical turks as a worker");

    const result = nacl.sign.detached.verify(
        message,
        new Uint8Array(signature.data),
        new PublicKey(publicKey).toBytes(),
    );

    if (!result) {
        return res.status(411).json({
            message: "Incorrect signature"
        })
    }

    const existingUser = await prismaClient.worker.findFirst({
        where: {
            address: publicKey
        }
    })

    if (existingUser) {
        const token = jwt.sign({
            userId: existingUser.id
        }, WORKER_JWTSECRET)

        res.json({
            token,
            amount: existingUser.pending_amount / TOTAL_DECIMALS
        })
    } else {
        const user = await prismaClient.worker.create({
            data: {
                address: publicKey,
                pending_amount: 0,
                locked_amount: 0
            }
        });

        const token = jwt.sign({
            userId: user.id
        }, WORKER_JWTSECRET)

        res.json({
            token,
            amount: 0
        })
    }
});
router.get("/balance", workerMiddleware, async (req, res) => {
    // @ts-ignore
    const userId: string = req.userId;

    const worker = await prismaClient.worker.findFirst({
        where: {
            id: Number(userId)
        }
    })

    res.json({
        pendingAmount: worker?.pending_amount,
        lockedAmount: worker?.pending_amount,
    })
})
router.post("/payout", workerMiddleware, async (req, res) => {
    // @ts-ignore
    const userId: string = req.userId;
    const worker = await prismaClient.worker.findFirst({
        where: { id: Number(userId) }
    })

    if (!worker) {
        return res.status(403).json({
            message: "User not found"
        })
    }
    /*
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: new PublicKey("2KeovpYvrgpziaDsq8nbNMP4mc48VNBVXb5arbqrg9Cq"),
                toPubkey: new PublicKey(worker.address),
                lamports: 1000_000_000 * worker.pending_amount / TOTAL_DECIMALS,
            })
        );
    
    
        console.log(worker.address);
    
        const keypair = Keypair.fromSecretKey(decode(privateKey));
    
        // TODO: There's a double spending problem here
        // The user can request the withdrawal multiple times
        // Can u figure out a way to fix it?
        let signature = "";
        try {
            signature = await sendAndConfirmTransaction(
                connection,
                transaction,
                [keypair],
            );
    
        } catch (e) {
            return res.json({
                message: "Transaction failed"
            })
        }
    
        console.log(signature)
    */
    // We should add a lock here
    console.log(worker.address);
    const address = worker.address;
    const tnxId = "0x123123123"
    await prismaClient.$transaction(async tx => {
        await tx.worker.update({
            where: {
                id: Number(userId)
            },
            data: {
                pending_amount: {
                    decrement: worker.pending_amount
                },
                locked_amount: {
                    increment: worker.pending_amount
                }
            }
        })

        await tx.payouts.create({
            data: {
                user_id: Number(userId),
                amount: worker.pending_amount,
                status: "Processing",
                signature: tnxId
            }
        })
    })

    res.json({
        message: "Processing payout",
        amount: worker.pending_amount
    })


})
router.post("/submission", workerMiddleware, async (req, res) => {
    // @ts-ignore
    const userId = req.userId;
    const body = req.body;
    const parsedBody = createSubmissionInput.safeParse(body);

    if (parsedBody.success) {
        const task = await getNextTask(Number(userId));
        if (!task || task?.id !== Number(parsedBody.data.taskId)) {
            return res.status(411).json({
                message: "Incorrect task id"
            })
        }

        const amount = (Number(task.amount) / TOTAL_SUBMISSIONS).toString();

        const submission = await prismaClient.$transaction(async tx => {
            const submission = await tx.submission.create({
                data: {
                    option_id: Number(parsedBody.data.selection),
                    worker_id: userId,
                    task_id: Number(parsedBody.data.taskId),
                    amount: Number(amount)
                }
            })

            await tx.worker.update({
                where: {
                    id: userId,
                },
                data: {
                    pending_amount: {
                        increment: Number(amount)
                    }
                }
            })

            return submission;
        })

        const nextTask = await getNextTask(Number(userId));
        res.json({
            nextTask,
            amount
        })


    } else {
        res.status(411).json({
            message: "Incorrect inputs"
        })

    }

})
router.get("/nextTask", workerMiddleware, async (req, res) => {
    // @ts-ignore
    const userId: string = req.userId;

    const task = await getNextTask(Number(userId));

    if (!task) {
        res.status(411).json({
            message: "No more tasks left for you to review"
        })
    } else {
        res.json({
            task
        })
    }
})
export default router;