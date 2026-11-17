import type { GuideBody } from "../../types";

export const body: GuideBody = {
  "sections": [
    {
      "heading": "What a photo file carries",
      "paragraphs": [
        "A photo is more than its pixels. Cameras and phones write a block of data called EXIF into the file. It usually holds the make and model of the device, the date and time, and the camera settings. If location services were on for the camera, it also holds the GPS position, often accurate to a few metres.",
        "Editing apps add more: the software used, sometimes an author name, sometimes a history of edits."
      ],
      "table": {
        "headers": [
          "Data",
          "Typical example",
          "Why it matters"
        ],
        "rows": [
          [
            "GPS position",
            "28.61389, 77.20833",
            "Shows where the photo was taken, such as your home"
          ],
          [
            "Device",
            "Apple iPhone 15 Pro",
            "Links photos to one phone"
          ],
          [
            "Date and time",
            "2024:05:17 10:30:00",
            "Shows when you were there"
          ],
          [
            "Serial number",
            "Camera body or lens",
            "Identifies one specific camera"
          ],
          [
            "Software and author",
            "Editor name, your name",
            "Can reveal identity"
          ]
        ],
        "caption": "None of this is visible in the picture. It travels inside the file."
      }
    },
    {
      "heading": "Who can read it",
      "paragraphs": [
        "Anyone who receives the original file. Opening the details of a photo on a phone or computer shows the map position in one tap.",
        "Large social networks usually strip this data when you post. Email, cloud links, marketplaces, forums, and many chat apps when you send a photo as a file do not. If you are not sure, assume the data is still there."
      ]
    },
    {
      "heading": "Remove it without touching the picture",
      "paragraphs": [
        "The safest way is to cut the data out of the file and leave the picture alone. For JPG, PNG, and WebP, Cutmoor does exactly that: the metadata blocks are removed and every pixel stays as it was, so there is no quality loss.",
        "Two things are kept on purpose. The colour profile stays, so colours look the same. And for phone photos the orientation number stays, because phones often save a photo sideways and rely on that number to show it upright."
      ],
      "bullets": [
        "Open Remove photo metadata and choose the photo.",
        "Read the list of what was found. A GPS position is marked in red.",
        "Press Remove hidden data and download the clean copy.",
        "Share the clean copy. Your original file is not changed."
      ],
      "callout": "Screenshots of a photo also drop the data, but they lower the resolution and can capture other things on your screen. Removing the data from the file is cleaner."
    },
    {
      "heading": "What stripping does not hide",
      "paragraphs": [
        "Metadata is only one way a photo gives away a place. A street sign, a shop front, a view from a window, or a reflection can do the same. Blur or black out those details before sharing.",
        "Turning off location for the camera app stops new photos from recording a position, but photos you already took keep theirs until you remove it."
      ]
    }
  ],
  "faqs": [
    {
      "question": "Does removing EXIF data reduce photo quality?",
      "answer": "Not for JPG, PNG, and WebP. The picture data is not decoded or re-encoded; only the hidden blocks are cut out of the file, so the pixels are identical."
    },
    {
      "question": "Do WhatsApp and Instagram remove location data?",
      "answer": "They usually do when a photo is sent or posted as a photo. Sending it as a document, by email, or through a cloud link keeps the original file with its data. Cleaning it yourself removes the doubt."
    },
    {
      "question": "How do I stop my phone saving location in photos?",
      "answer": "Turn off location access for the camera app in the privacy settings of the phone. New photos then have no position. Older photos keep theirs until it is removed."
    }
  ]
};
