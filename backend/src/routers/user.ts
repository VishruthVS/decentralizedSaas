import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { PrismaClient } from "@prisma/client";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config";
import { authMiddleware } from "../middleware";
import { createTaskInput } from "../types";
const DEFAULT_TITLE = "Select the most clickable thumbnail";
const s3Client = new S3Client({
    credentials: {
        accessKeyId: process.env.ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.ACCESS_SECRET ?? "",
    },
    region: "ap-south-1"
});
const router = Router();
const prismaClient = new PrismaClient();


router.get("/task", authMiddleware, async (req, res) => {
    // @ts-ignore
    const taskId: string = req.query.taskId;
    // @ts-ignore
    const userId: string = req.userId;

    const taskDetails = await prismaClient.task.findFirst({
        where: {
            user_id: Number(userId),
            id: Number(taskId)
        },
        include: {
            options: true
        }
    })

    if (!taskDetails) {
        return res.status(411).json({
            message: "You dont have access to this task"
        })
    }

    // Todo: Can u make this faster?
    const responses = await prismaClient.submission.findMany({
        where: {
            task_id: Number(taskId)
        },
        include: {
            option: true
        }
    });

    const result: Record<string, {
        count: number;
        option: {
            imageUrl: string
        }
    }> = {};

    taskDetails.options.forEach(option => {
        result[option.id] = {
            count: 0,
            option: {
                imageUrl: option.image_url
            }
        }
    })

    responses.forEach(r => {
        result[r.option_id].count++;
    });

    res.json({
        result,
        taskDetails
    })

})

router.post("/task", authMiddleware, async (req, res) => {
    //@ts-ignore
    const userId = req.userId;

    const body = req.body;

    const parsedData = createTaskInput.safeParse(body);

    if (!parsedData.success) {
        res.status(411).json({
            message: "You have sent the wrong inputs"
        })
    }
    let response = await prismaClient.$transaction(async tx => {

        const response = await tx.task.create({
            data: {
                //@ts-ignore
                title: parsedData.data.title ?? DEFAULT_TITLE,
                amount: 0.1,
                //TODO: Signature should be unique in the table else people can reuse a signature
                //@ts-ignore
                signature: parsedData.data.signature,
                user_id: userId
            }
        });

        await tx.option.createMany({
            //@ts-ignore
            data: parsedData.data.options.map(x => ({
                image_url: x.imageUrl,
                task_id: response.id
            }))
        })

        return response;

    })
    res.json({
        id: response.id
    })
})
router.get("/presignedUrl", authMiddleware, async (req, res) => {
    // @ts-ignore
    const userId = req.userId;

    const { url, fields } = await createPresignedPost(s3Client, {
        Bucket: 'decentralised-saas',
        Key: `fiver/${userId}/${Math.random()}/image.jpg`,
        Conditions: [
            ['content-length-range', 0, 5 * 1024 * 1024] // 5 MB max
        ],
        Fields: {
            'Content-Type': 'image/png'
        },
        Expires: 3600
    })

    res.json({
        preSignedUrl: url,
        fields
    })

})

router.post("/signin", async (req, res) => {
    const hardCodedWalletAddress = "0xCDAF44CE32B7f1CdA63d1d2D2b8F47951377A670"
    const existingUser = await prismaClient.user.findFirst({
        where: {
            address: hardCodedWalletAddress
        }
    })
    if (existingUser) {
        const token = jwt.sign({
            userId: existingUser.id
        }, JWT_SECRET)
        res.json({
            token
        })
    } else {
        const user = await prismaClient.user.create({
            data: {
                address: hardCodedWalletAddress
            }
        })

        const token = jwt.sign({
            userId: user.id
        }, JWT_SECRET)
        res.json({
            token
        })
    }
});
//eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjIsImlhdCI6MTcxODcxNjUyN30.R2f0aEErqmD4npP1iEDfRjmLJcylk7VbwPx3AuO_aYss
router.get("/signup", async (req, res) => {
    res.send('Hello, World!');
});

export default router;